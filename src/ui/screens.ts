import { h, button } from "./dom";
import { makeOvalTrack, LAPS_TO_WIN } from "../game/track";
import type { TrackDef } from "../game/track";
import { applyCamera, drawCar, drawMinimap, drawTrack } from "../game/renderer";
import type { RenderCar } from "../game/renderer";
import { InputManager } from "../game/input";
import { GameLoop } from "../game/loop";
import { RaceSession } from "../game/race";
import { PLAYER_COLORS, randomPlayerId } from "../net/protocol";
import type { PlayerInfo } from "../net/protocol";
import { HostLobby, GuestLobby } from "../net/lobby";
import { renderQR, startQRScan } from "../net/qr";
import type { QRScanner } from "../net/qr";

const PROFILE_KEY = "toy-racers:profile";

interface Profile {
  name: string;
  color: string;
}

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { name: "Racer", color: PLAYER_COLORS[0] };
}

function saveProfile(p: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

export class App {
  private uiRoot: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private track: TrackDef;

  private input?: InputManager;
  private loop?: GameLoop;
  private race?: RaceSession;
  private activeScanner?: QRScanner;
  private profile: Profile = loadProfile();
  private resultsShown = false;

  constructor(mount: HTMLElement) {
    this.canvas = h("canvas", "game-canvas");
    this.uiRoot = h("div", "ui-root");
    const rotateHint = h("div", "rotate-hint", "Rotate your phone for the best view 🔄");
    mount.append(this.canvas, this.uiRoot, rotateHint);
    this.ctx = this.canvas.getContext("2d")!;
    this.track = makeOvalTrack(2600, 1700);

    window.addEventListener("resize", this.resizeCanvas);
    this.resizeCanvas();
    this.showMenu();
  }

  private resizeCanvas = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = window.innerWidth + "px";
    this.canvas.style.height = window.innerHeight + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  private setScreen(el: HTMLElement) {
    this.stopScanner();
    this.uiRoot.replaceChildren(el);
  }

  private stopScanner() {
    this.activeScanner?.stop();
    this.activeScanner = undefined;
  }

  private teardownRace() {
    this.loop?.stop();
    this.loop = undefined;
    this.input?.destroy();
    this.input = undefined;
    this.race = undefined;
    this.resultsShown = false;
  }

  // ---------------------------------------------------------------- Menu --

  private showMenu() {
    this.teardownRace();
    this.canvas.classList.remove("visible");
    document.body.classList.remove("racing");

    const nameInput = h("input", "name-input") as HTMLInputElement;
    nameInput.maxLength = 14;
    nameInput.placeholder = "Your name";
    nameInput.value = this.profile.name;
    nameInput.addEventListener("input", () => {
      this.profile.name = nameInput.value.trim() || "Racer";
      saveProfile(this.profile);
    });

    const swatches = h(
      "div",
      "color-swatches",
      ...PLAYER_COLORS.map((c) => {
        const dot = h("div", "swatch");
        dot.style.background = c;
        if (c === this.profile.color) dot.classList.add("selected");
        dot.addEventListener("click", () => {
          this.profile.color = c;
          saveProfile(this.profile);
          swatches.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
          dot.classList.add("selected");
        });
        return dot;
      }),
    );

    const screen = h(
      "div",
      "screen menu-screen",
      h("h1", "title", "🏎️ Toy Racers"),
      h("p", "subtitle", "Top-down toy car racing. Play solo, or connect with friends on the same Wi-Fi — no internet or account needed."),
      h("label", "field-label", "Name", nameInput),
      h("label", "field-label", "Color", swatches),
      h(
        "div",
        "menu-actions",
        button("Host a Race", "btn btn-primary", () => this.showHostLobby()),
        button("Join a Race", "btn btn-secondary", () => this.showJoinLobby()),
        button("Practice Solo", "btn btn-ghost", () => this.startPractice()),
      ),
      h(
        "p",
        "hint",
        "Bluetooth can't run inside an installed web app on iPhone, so nearby multiplayer here works over a shared Wi-Fi/hotspot instead — one friend taps Host, everyone else scans in with Join.",
      ),
    );
    this.setScreen(screen);
  }

  private localPlayerInfo(slot: number): PlayerInfo {
    return { id: randomPlayerId(), name: this.profile.name, color: this.profile.color, slot };
  }

  // ---------------------------------------------------------- Host lobby --

  private showHostLobby() {
    const localInfo = this.localPlayerInfo(0);
    const hostLobby = new HostLobby(localInfo);

    const rosterEl = h("div", "roster-list");
    const statusEl = h("p", "status-text", "");
    const qrBox = h("div", "qr-box");

    const renderRoster = (players: PlayerInfo[]) => {
      rosterEl.replaceChildren(...players.map((p) => rosterItem(p, p.id === localInfo.id ? " (you, host)" : "")));
    };
    renderRoster(hostLobby.players);
    hostLobby.onRosterChange(renderRoster);

    const addPlayerBtn = button("+ Add Player (show QR)", "btn btn-secondary", async () => {
      addPlayerBtn.disabled = true;
      statusEl.textContent = "Generating invite…";
      try {
        const { pc, control, state, payload } = await hostLobby.createInvite();
        qrBox.replaceChildren();
        const canvas = h("canvas");
        qrBox.append(canvas);
        await renderQR(canvas, payload);
        statusEl.textContent = "Have your friend open Toy Racers → Join a Race → Scan Host, and scan this code.";

        const scanAnswerBtn = button("Scan Their Answer Code", "btn btn-primary", () => {
          scanAnswerBtn.disabled = true;
          this.openScanner(
            async (text) => {
              this.stopScanner();
              try {
                statusEl.textContent = "Connecting…";
                await hostLobby.acceptAnswer(pc, control, state, text);
                statusEl.textContent = "Player connected! Add another, or start the race.";
              } catch (err) {
                statusEl.textContent = errorMessage(err);
              } finally {
                qrBox.replaceChildren();
                addPlayerBtn.disabled = false;
                addPlayerBtn.textContent = "+ Add Player (show QR)";
              }
            },
            (err) => (statusEl.textContent = errorMessage(err)),
          );
        });
        qrBox.append(scanAnswerBtn);
      } catch (err) {
        statusEl.textContent = errorMessage(err);
        addPlayerBtn.disabled = false;
      }
    });

    const startBtn = button("Start Race", "btn btn-primary btn-start", () => {
      this.beginHostRace(hostLobby);
    });

    const screen = h(
      "div",
      "screen lobby-screen",
      h("h2", "title", "Host a Race"),
      statusEl,
      rosterEl,
      qrBox,
      h("div", "menu-actions", addPlayerBtn, startBtn),
      button("Back", "btn btn-ghost", () => this.showMenu()),
    );
    this.setScreen(screen);
  }

  private beginHostRace(hostLobby: HostLobby) {
    const input = new InputManager(this.uiRoot);
    const race = new RaceSession(
      this.track,
      hostLobby.localPlayer,
      hostLobby.players,
      input,
      true,
      (msg) => hostLobby.broadcast(msg),
    );
    hostLobby.onMessage(({ msg }) => race.handleNetMessage(msg));
    this.input = input;
    this.race = race;
    race.startCountdown();
    this.showRaceScreen();
  }

  // ---------------------------------------------------------- Join lobby --

  private showJoinLobby() {
    const guestLobby = new GuestLobby(this.profile.name, this.profile.color);

    const statusEl = h("p", "status-text", "Scan the host's invite code to connect.");
    const qrBox = h("div", "qr-box");
    const rosterEl = h("div", "roster-list");

    guestLobby.onRosterChange((players) => {
      rosterEl.replaceChildren(
        ...players.map((p) => rosterItem(p, p.id === guestLobby.localPlayer.id ? " (you)" : "")),
      );
      statusEl.textContent = "Connected! Waiting for the host to start the race…";
    });

    guestLobby.onMessage((msg) => {
      if (!this.race && msg.type === "countdown") this.beginGuestRace(guestLobby);
      this.race?.handleNetMessage(msg);
    });

    const scanBtn = button("Scan Host's Invite", "btn btn-primary", () => {
      scanBtn.disabled = true;
      statusEl.textContent = "Point your camera at the host's QR code…";
      this.openScanner(
        async (text) => {
          this.stopScanner();
          try {
            statusEl.textContent = "Generating answer code…";
            const payload = await guestLobby.createAnswer(text);
            qrBox.replaceChildren();
            const canvas = h("canvas");
            qrBox.append(canvas);
            await renderQR(canvas, payload);
            statusEl.textContent = "Show this code back to the host to finish connecting.";
          } catch (err) {
            statusEl.textContent = errorMessage(err);
            scanBtn.disabled = false;
          }
        },
        (err) => {
          statusEl.textContent = errorMessage(err);
          scanBtn.disabled = false;
        },
      );
    });

    const screen = h(
      "div",
      "screen lobby-screen",
      h("h2", "title", "Join a Race"),
      statusEl,
      qrBox,
      rosterEl,
      h("div", "menu-actions", scanBtn),
      button("Back", "btn btn-ghost", () => this.showMenu()),
    );
    this.setScreen(screen);
  }

  private beginGuestRace(guestLobby: GuestLobby) {
    const input = new InputManager(this.uiRoot);
    const race = new RaceSession(
      this.track,
      guestLobby.localPlayer,
      guestLobby.players,
      input,
      false,
      (msg) => guestLobby.send(msg),
    );
    this.input = input;
    this.race = race;
    this.showRaceScreen();
  }

  // -------------------------------------------------------------- Practice

  private startPractice() {
    const localInfo = this.localPlayerInfo(0);
    const input = new InputManager(this.uiRoot);
    const race = new RaceSession(this.track, localInfo, [localInfo], input, true, () => {});
    this.input = input;
    this.race = race;
    race.startCountdown();
    this.showRaceScreen();
  }

  // --------------------------------------------------------------- Race --

  private showRaceScreen() {
    this.canvas.classList.add("visible");
    document.body.classList.add("racing");

    const hud = h(
      "div",
      "hud",
      h("div", "hud-lap"),
      h("div", "hud-countdown"),
    );
    this.setScreen(hud);
    // input controls mount themselves into uiRoot on construction (see InputManager)

    this.loop = new GameLoop((dt) => this.frame(dt, hud));
    this.loop.start();
  }

  private frame(dt: number, hud: HTMLElement) {
    const race = this.race;
    if (!race) return;
    race.update(dt);

    this.render(race);
    this.updateHud(race, hud);

    if (race.isRaceComplete && !this.resultsShown) {
      this.resultsShown = true;
      setTimeout(() => this.showResults(race), 1200);
    }
  }

  private render(race: RaceSession) {
    const ctx = this.ctx;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h2 = this.canvas.height / (window.devicePixelRatio || 1);

    ctx.save();
    applyCamera(ctx, w, h2, race.localCar.x, race.localCar.y);
    drawTrack(ctx, this.track);

    const cars: RenderCar[] = [
      { car: race.localCar, color: race.localInfo.color, label: race.localInfo.name, isLocal: true },
      ...[...race.remotes.values()].map((r) => ({
        car: r.car,
        color: r.info.color,
        label: r.info.name,
        isLocal: false,
      })),
    ];
    for (const rc of cars) drawCar(ctx, rc);
    ctx.restore();

    ctx.save();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    drawMinimap(ctx, w, this.track, cars);
    ctx.restore();
  }

  private updateHud(race: RaceSession, hud: HTMLElement) {
    const lapEl = hud.querySelector(".hud-lap") as HTMLElement;
    const cdEl = hud.querySelector(".hud-countdown") as HTMLElement;
    lapEl.textContent = `Lap ${Math.min(race.localCar.lap + 1, LAPS_TO_WIN)} / ${LAPS_TO_WIN}`;

    if (race.countdownMs > 0) {
      cdEl.textContent = String(Math.ceil(race.countdownMs / 1000));
      cdEl.classList.add("visible");
    } else if (!race.started) {
      cdEl.textContent = "";
      cdEl.classList.remove("visible");
    } else {
      cdEl.classList.remove("visible");
    }
  }

  private showResults(race: RaceSession) {
    this.loop?.stop();
    this.canvas.classList.remove("visible");
    document.body.classList.remove("racing");

    const list = h(
      "div",
      "results-list",
      ...race.results.map((r) =>
        h(
          "div",
          "results-item",
          h("span", "results-place", `#${r.place}`),
          h("span", "results-name", r.name),
          h("span", "results-time", formatTime(r.timeMs)),
        ),
      ),
    );

    const screen = h(
      "div",
      "screen results-screen",
      h("h2", "title", "🏁 Results"),
      list,
      h("div", "menu-actions", button("Back to Menu", "btn btn-primary", () => this.showMenu())),
    );
    this.setScreen(screen);
  }

  // ------------------------------------------------------------ Scanning --

  private openScanner(onResult: (text: string) => void, onError: (err: unknown) => void) {
    this.stopScanner();
    const video = h("video", "scan-video");
    const overlay = h(
      "div",
      "scan-overlay",
      video,
      h("p", "hint", "Point the camera at the QR code"),
      button("Cancel", "btn btn-ghost", () => {
        this.stopScanner();
        overlay.remove();
      }),
    );
    this.uiRoot.append(overlay);
    this.activeScanner = startQRScan(
      video,
      (text) => {
        overlay.remove();
        onResult(text);
      },
      (err) => {
        overlay.remove();
        onError(err);
      },
    );
  }
}

function formatTime(ms: number) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2);
  return `${minutes}:${seconds.padStart(5, "0")}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong. Make sure camera permission is granted and try again.";
}

function rosterItem(p: PlayerInfo, suffix: string) {
  const dot = h("span", "roster-dot");
  dot.style.background = p.color;
  return h("div", "roster-item", dot, h("span", "roster-name", p.name + suffix));
}
