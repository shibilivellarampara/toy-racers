import { h, button } from "./dom";
import { makeCircuitTrack, LAPS_TO_WIN } from "../game/track";
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
const QR_PREFIX = "TR:";

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

function codeToQrPayload(code: string) {
  return QR_PREFIX + code;
}

function qrPayloadToCode(text: string): string {
  const m = text.trim().match(/^TR:(\d{4})$/);
  if (!m) throw new Error("That's not a Toy Racers code. Try typing the 4-digit code instead.");
  return m[1];
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
    mount.append(this.canvas, this.uiRoot);
    this.ctx = this.canvas.getContext("2d")!;
    this.track = makeCircuitTrack();

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
      h(
        "p",
        "subtitle",
        "Top-down toy car racing. Play solo, or connect with friends on the same Wi-Fi — no internet or account needed.",
      ),
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
        "Bluetooth can't run inside an installed web app on iPhone, so nearby multiplayer works over a shared Wi-Fi/hotspot instead — the host shares a 4-digit code (or QR), everyone else enters it with Join.",
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
    const inviteBox = h("div", "invite-box");

    const renderRoster = (players: PlayerInfo[]) => {
      rosterEl.replaceChildren(...players.map((p) => rosterItem(p, p.id === localInfo.id ? " (you, host)" : "")));
    };
    renderRoster(hostLobby.players);
    hostLobby.onRosterChange(renderRoster);

    const addPlayerBtn = button("+ Add Player", "btn btn-secondary", () => startInvite());

    const startInvite = () => {
      addPlayerBtn.disabled = true;
      inviteBox.replaceChildren();

      const invite = hostLobby.createInvite();
      const qrCanvas = h("canvas");
      const cancelBtn = button("Cancel", "btn btn-ghost", () => {
        invite.cancel();
        inviteBox.replaceChildren();
        addPlayerBtn.disabled = false;
        statusEl.textContent = "";
      });
      inviteBox.append(
        h("p", "hint", "Give your friend this code, or let them scan the QR:"),
        h("div", "room-code", invite.code),
        qrCanvas,
        cancelBtn,
      );
      renderQR(qrCanvas, codeToQrPayload(invite.code)).catch(() => {});
      statusEl.textContent = `Waiting for a friend to enter ${invite.code}…`;

      invite.waitForGuest
        .then(() => {
          statusEl.textContent = "Player connected! Add another, or start the race.";
          inviteBox.replaceChildren();
          addPlayerBtn.disabled = false;
        })
        .catch((err) => {
          inviteBox.replaceChildren();
          addPlayerBtn.disabled = false;
          if (!(err instanceof Error && err.message === "Cancelled")) {
            statusEl.textContent = errorMessage(err);
          }
        });
    };

    const startBtn = button("Start Race", "btn btn-primary btn-start", () => {
      this.beginHostRace(hostLobby);
    });

    const screen = h(
      "div",
      "screen lobby-screen",
      h("h2", "title", "Host a Race"),
      statusEl,
      rosterEl,
      inviteBox,
      h("div", "menu-actions", addPlayerBtn, startBtn),
      button("Back", "btn btn-ghost", () => this.showMenu()),
    );
    this.setScreen(screen);
  }

  private beginHostRace(hostLobby: HostLobby) {
    const input = new InputManager();
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

    const statusEl = h("p", "status-text", "Ask your host for their 4-digit code.");
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

    const codeInput = h("input", "code-input") as HTMLInputElement;
    codeInput.inputMode = "numeric";
    codeInput.autocomplete = "off";
    codeInput.maxLength = 4;
    codeInput.placeholder = "0000";
    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 4);
    });

    const connect = async (code: string) => {
      if (code.length !== 4) {
        statusEl.textContent = "Enter the 4-digit code your host gave you.";
        return;
      }
      connectBtn.disabled = true;
      scanBtn.disabled = true;
      statusEl.textContent = `Connecting to ${code}…`;
      try {
        await guestLobby.connectWithCode(code);
        statusEl.textContent = "Connected! Waiting for the host to start the race…";
      } catch (err) {
        statusEl.textContent = errorMessage(err);
        connectBtn.disabled = false;
        scanBtn.disabled = false;
      }
    };

    const connectBtn = button("Connect", "btn btn-primary", () => connect(codeInput.value));
    const scanBtn = button("Scan QR Instead", "btn btn-secondary", () => {
      scanBtn.disabled = true;
      statusEl.textContent = "Point your camera at the host's QR code…";
      this.openScanner(
        (text) => {
          try {
            const code = qrPayloadToCode(text);
            codeInput.value = code;
            connect(code);
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
      h("label", "field-label", "Room Code", codeInput),
      h("div", "menu-actions", connectBtn, scanBtn),
      rosterEl,
      button("Back", "btn btn-ghost", () => this.showMenu()),
    );
    this.setScreen(screen);
  }

  private beginGuestRace(guestLobby: GuestLobby) {
    const input = new InputManager();
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
    const input = new InputManager();
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
      h("div", "hud-timer"),
      h("div", "hud-speed"),
      h("div", "hud-standings"),
      h("div", "hud-countdown"),
      h("div", "hud-boost-flash", "BOOST!"),
    );

    this.stopScanner();
    this.uiRoot.replaceChildren(hud, this.input!.element);

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
      {
        car: race.localCar,
        color: race.localInfo.color,
        label: race.localInfo.name,
        isLocal: true,
        boosting: race.localCar.boosting,
      },
      ...[...race.remotes.values()].map((r) => ({
        car: r.car,
        color: r.info.color,
        label: r.info.name,
        isLocal: false,
        boosting: r.boosting,
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
    const timerEl = hud.querySelector(".hud-timer") as HTMLElement;
    const speedEl = hud.querySelector(".hud-speed") as HTMLElement;
    const standingsEl = hud.querySelector(".hud-standings") as HTMLElement;
    const boostFlashEl = hud.querySelector(".hud-boost-flash") as HTMLElement;

    lapEl.textContent = `Lap ${Math.min(race.localCar.lap + 1, LAPS_TO_WIN)} / ${LAPS_TO_WIN}`;
    timerEl.textContent = formatTime(race.localCar.raceTimeMs);

    const speed = Math.round(Math.abs(race.localCar.speed) / 4);
    const top = Math.round(race.localCar.topSpeed / 4);
    speedEl.textContent = `${speed} km/h  ·  top ${top}`;

    standingsEl.replaceChildren(
      ...race
        .getStandings()
        .map((s) => h("div", `standing-row${s.isLocal ? " standing-row--you" : ""}`, `${s.place}. ${s.name}`)),
    );

    boostFlashEl.classList.toggle("visible", race.localCar.boosting);

    if (race.countdownMs > 0) {
      cdEl.textContent = String(Math.ceil(race.countdownMs / 1000));
      cdEl.classList.add("visible");
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
