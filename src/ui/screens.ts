import { h, button } from "./dom";
import { buildTrack, DEFAULT_TRACK_ID, TRACK_LIST, LAPS_TO_WIN } from "../game/track";
import type { TrackDef } from "../game/track";
import { applyCamera, drawCar, drawImpactEffects, drawMinimap, drawTrack, drawUnderpassDeck } from "../game/renderer";
import type { RenderCar } from "../game/renderer";
import { InputManager } from "../game/input";
import { GameLoop } from "../game/loop";
import { RaceSession } from "../game/race";
import { sound } from "../game/sound";
import { PLAYER_COLORS, randomPlayerId } from "../net/protocol";
import type { PlayerInfo } from "../net/protocol";
import { HostLobby, GuestLobby } from "../net/lobby";
import { renderQR, startQRScan } from "../net/qr";
import type { QRScanner } from "../net/qr";

const PROFILE_KEY = "toy-racers:profile";

interface Profile {
  name: string;
  color: string;
  muted: boolean;
}

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return { muted: false, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { name: "Racer", color: PLAYER_COLORS[0], muted: false };
}

function saveProfile(p: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

// A real app URL (not just a short code) so scanning with the phone's own
// camera app opens Toy Racers directly and joins, without needing the
// in-app scanner already open.
function codeToQrPayload(code: string) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("code", code);
  return url.toString();
}

function qrPayloadToCode(text: string): string {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (code && /^\d{4}$/.test(code)) return code;
  } catch {
    /* not a URL, fall through */
  }
  const m = trimmed.match(/^TR:(\d{4})$/);
  if (m) return m[1];
  throw new Error("That's not a Toy Racers code. Try typing the 4-digit code instead.");
}

export class App {
  private uiRoot: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private track: TrackDef;
  private selectedMapId: string = DEFAULT_TRACK_ID;
  private dpr = 1;

  private input?: InputManager;
  private loop?: GameLoop;
  private race?: RaceSession;
  private activeScanner?: QRScanner;
  private profile: Profile = loadProfile();
  private resultsShown = false;

  private activeHostLobby?: HostLobby;
  private activeGuestLobby?: GuestLobby;
  private vsComputer = false;

  private prevCountdownSecond = -1;
  private prevLap = 0;

  constructor(mount: HTMLElement) {
    this.canvas = h("canvas", "game-canvas");
    this.uiRoot = h("div", "ui-root");
    mount.append(this.canvas, this.uiRoot);
    this.ctx = this.canvas.getContext("2d")!;
    this.track = buildTrack(this.selectedMapId);
    sound.setMuted(this.profile.muted);

    window.addEventListener("resize", this.resizeCanvas);
    window.addEventListener("orientationchange", this.onOrientationChange);
    window.visualViewport?.addEventListener("resize", this.resizeCanvas);
    this.resizeCanvas();

    const deepLinkCode = new URLSearchParams(window.location.search).get("code");
    history.replaceState(null, "", window.location.pathname);
    if (deepLinkCode && /^\d{4}$/.test(deepLinkCode)) {
      this.showJoinLobby(deepLinkCode);
    } else {
      this.showMenu();
    }
  }

  private resizeCanvas = () => {
    // visualViewport tracks the actually-visible area on mobile (accounting
    // for on-screen keyboards / browser chrome); innerWidth/innerHeight can
    // lag behind it, which is what causes the canvas to drift out of sync
    // with the rest of the UI on some phones.
    const vv = window.visualViewport;
    const width = Math.round(vv?.width ?? window.innerWidth);
    const height = Math.round(vv?.height ?? window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  // iOS can report stale innerWidth/innerHeight for a beat right after
  // rotation, so re-measure a couple of times after the event fires.
  private onOrientationChange = () => {
    this.resizeCanvas();
    setTimeout(this.resizeCanvas, 60);
    setTimeout(this.resizeCanvas, 250);
  };

  // Belt-and-suspenders: if a resize/orientation event ever gets missed or
  // arrives late (seen on some mobile browsers around chrome show/hide),
  // this catches the drift on the very next rendered frame instead of
  // leaving the canvas buffer sized for a stale layout — which is what
  // makes the camera look off-center even though the centering math itself
  // is correct.
  private ensureCanvasSize() {
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const expectedW = Math.round(cssWidth * this.dpr);
    const expectedH = Math.round(cssHeight * this.dpr);
    if (Math.abs(this.canvas.width - expectedW) > 1 || Math.abs(this.canvas.height - expectedH) > 1) {
      this.resizeCanvas();
    }
  }

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
    sound.stopEngine();
    sound.stopTrainRumble();
  }

  // ---------------------------------------------------------------- Menu --

  private showMenu() {
    this.teardownRace();
    this.activeHostLobby?.close();
    this.activeHostLobby = undefined;
    this.activeGuestLobby?.close();
    this.activeGuestLobby = undefined;
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

    const muteBtn = button(this.profile.muted ? "🔇 Off" : "🔊 On", "map-option", () => {
      this.profile.muted = !this.profile.muted;
      saveProfile(this.profile);
      sound.setMuted(this.profile.muted);
      muteBtn.textContent = this.profile.muted ? "🔇 Off" : "🔊 On";
    });

    const screen = h(
      "div",
      "screen menu-screen",
      h("h1", "title", "🏎️ Toy Racers"),
      h(
        "p",
        "subtitle",
        "Top-down toy car racing with friends. Connect over the same Wi-Fi — no internet or account needed.",
      ),
      h("label", "field-label", "Name", nameInput),
      h("label", "field-label", "Color", swatches),
      h("div", "field-label", "Sound", muteBtn),
      h(
        "div",
        "menu-actions",
        button("Host a Race", "btn btn-primary", () => this.showHostLobby()),
        button("Join a Race", "btn btn-secondary", () => this.showJoinLobby()),
        button("🖥 Play vs Computer", "btn btn-secondary", () => this.showVsComputerSetup()),
      ),
      h(
        "p",
        "hint",
        "Bluetooth can't run inside an installed web app on iPhone, so nearby multiplayer works over a shared Wi-Fi/hotspot instead — the host shares a 4-digit code (or QR), everyone else enters it with Join.",
      ),
      h("p", "credit-line", "Developed by Shibil"),
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
    hostLobby.onMessage(({ msg }) => this.race?.handleNetMessage(msg));

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
      startBtn.disabled = true;
      addPlayerBtn.disabled = true;
      this.runLobbyCountdown(() => this.beginHostRace(hostLobby));
    });

    const mapEl = h("div", "map-list");
    const renderMaps = () => {
      mapEl.replaceChildren(
        ...TRACK_LIST.map((m) => {
          const b = button(m.name, `map-option${m.id === this.selectedMapId ? " selected" : ""}`, () => {
            this.selectedMapId = m.id;
            this.track = buildTrack(m.id);
            renderMaps();
          });
          return b;
        }),
      );
    };
    renderMaps();

    const screen = h(
      "div",
      "screen lobby-screen",
      h("h2", "title", "Host a Race"),
      h("div", "field-label", "Map", mapEl),
      statusEl,
      rosterEl,
      inviteBox,
      h("div", "menu-actions", addPlayerBtn, startBtn),
      button("Back", "btn btn-ghost", () => this.showMenu()),
    );
    this.setScreen(screen);
  }

  // Shown in the host's lobby only, before the race screen (and its own
  // separate 3s in-race countdown) ever appears — gives the host a moment
  // after clicking Start Race before everyone gets dropped into the race.
  private runLobbyCountdown(onDone: () => void, seconds = 5) {
    let remaining = seconds;
    const numberEl = h("div", "lobby-countdown-number", String(remaining));
    const overlay = h("div", "lobby-countdown-overlay", numberEl, h("p", "lobby-countdown-label", "Get ready…"));
    document.body.appendChild(overlay);
    sound.unlock();
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        overlay.remove();
        onDone();
        return;
      }
      numberEl.textContent = String(remaining);
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  private beginHostRace(hostLobby: HostLobby) {
    this.vsComputer = false;
    const input = new InputManager();
    const race = new RaceSession(
      this.track,
      hostLobby.localPlayer,
      hostLobby.players,
      input,
      true,
      (msg) => hostLobby.broadcast(msg),
    );
    this.activeHostLobby = hostLobby;
    this.input = input;
    this.race = race;
    race.startCountdown(this.selectedMapId);
    this.showRaceScreen();
  }

  private showVsComputerSetup() {
    const mapEl = h("div", "map-list");
    const renderMaps = () => {
      mapEl.replaceChildren(
        ...TRACK_LIST.map((m) =>
          button(m.name, `map-option${m.id === this.selectedMapId ? " selected" : ""}`, () => {
            this.selectedMapId = m.id;
            this.track = buildTrack(m.id);
            renderMaps();
          }),
        ),
      );
    };
    renderMaps();

    const screen = h(
      "div",
      "screen lobby-screen",
      h("h2", "title", "Play vs Computer"),
      h("div", "field-label", "Map", mapEl),
      h("p", "hint", "You + 3 computer racers, no connection needed."),
      h("div", "menu-actions", button("Start Race", "btn btn-primary btn-start", () => this.startVsComputer())),
      button("Back", "btn btn-ghost", () => this.showMenu()),
    );
    this.setScreen(screen);
  }

  // Fully local — no lobby, no network — so it doesn't need any of the
  // WebRTC/relay machinery. isHost is still true because RaceSession uses
  // that flag to decide who's authoritative for finish order, and here
  // that's trivially always us.
  private startVsComputer() {
    this.teardownRace();
    this.vsComputer = true;
    const localInfo = this.localPlayerInfo(0);
    const CPU_COUNT = 3; // player + 3 bots = 4 cars total
    const roster: PlayerInfo[] = [localInfo];
    for (let i = 0; i < CPU_COUNT; i++) {
      roster.push({
        id: randomPlayerId(),
        name: `CPU ${i + 1}`,
        color: PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length],
        slot: i + 1,
        isAI: true,
      });
    }
    const input = new InputManager();
    const race = new RaceSession(this.track, localInfo, roster, input, true, () => {});
    this.input = input;
    this.race = race;
    race.startCountdown(this.selectedMapId);
    this.showRaceScreen();
  }

  // ---------------------------------------------------------- Join lobby --

  private showJoinLobby(prefillCode?: string) {
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
      if (msg.type === "countdown" && (!this.race || this.race.isRaceComplete)) {
        this.teardownRace();
        this.track = buildTrack(msg.mapId);
        this.beginGuestRace(guestLobby);
      }
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

    if (prefillCode) {
      codeInput.value = prefillCode;
      connect(prefillCode);
    }
  }

  private beginGuestRace(guestLobby: GuestLobby) {
    this.vsComputer = false;
    const input = new InputManager();
    const race = new RaceSession(
      this.track,
      guestLobby.localPlayer,
      guestLobby.players,
      input,
      false,
      (msg) => guestLobby.send(msg),
    );
    this.activeGuestLobby = guestLobby;
    this.input = input;
    this.race = race;
    this.showRaceScreen();
  }

  // --------------------------------------------------------------- Race --

  private showRaceScreen() {
    this.canvas.classList.add("visible");
    document.body.classList.add("racing");
    this.prevCountdownSecond = -1;
    this.prevLap = 0;
    sound.startEngine();

    const hud = h(
      "div",
      "hud",
      h("div", "hud-lap"),
      h("div", "hud-timer"),
      h("div", "hud-speed"),
      h("div", "hud-standings"),
      h("div", "hud-countdown"),
      h("div", "hud-boost-flash", "BOOST!"),
      button("☰ Menu", "hud-quit-btn", () => this.openPauseMenu()),
    );

    this.stopScanner();
    this.uiRoot.replaceChildren(hud, this.input!.element);

    this.loop = new GameLoop((dt) => this.frame(dt, hud));
    this.loop.start();
  }

  private openPauseMenu() {
    const race = this.race;
    if (!race || !this.loop) return;
    this.loop.stop();
    sound.updateEngine(0);

    const close = () => overlay.remove();
    const resume = () => {
      close();
      this.loop?.start();
    };
    const restart = () => {
      close();
      const hostLobby = this.activeHostLobby;
      const wasVsComputer = this.vsComputer;
      this.teardownRace();
      if (wasVsComputer) this.startVsComputer();
      else if (hostLobby) this.beginHostRace(hostLobby);
      else this.showMenu();
    };

    const muteBtn = button(this.profile.muted ? "🔇 Sound Off" : "🔊 Sound On", "btn btn-secondary", () => {
      this.profile.muted = !this.profile.muted;
      saveProfile(this.profile);
      sound.setMuted(this.profile.muted);
      muteBtn.textContent = this.profile.muted ? "🔇 Sound Off" : "🔊 Sound On";
    });

    const overlay = h(
      "div",
      "pause-overlay",
      h(
        "div",
        "screen",
        h("h2", "title", "Paused"),
        h(
          "div",
          "menu-actions",
          button("▶ Resume", "btn btn-primary", resume),
          muteBtn,
          race.isHost
            ? button("⟲ Restart Race", "btn btn-secondary", restart)
            : h("p", "hint", "Only the host can restart the race."),
          button("🏠 Main Menu", "btn btn-ghost", () => this.showMenu()),
        ),
      ),
    );
    this.uiRoot.appendChild(overlay);
  }

  private frame(dt: number, hud: HTMLElement) {
    this.ensureCanvasSize();
    const race = this.race;
    if (!race) return;
    race.update(dt);

    this.render(race);
    this.updateHud(race, hud);
    this.updateSounds(race);

    // In a real multiplayer race, wait for everyone so all players see the
    // same final standings together. Against computer bots there's no one
    // else actually waiting, so show results as soon as the local player
    // finishes rather than sitting there until the slowest bot crosses.
    const done = this.vsComputer ? race.localCar.finished : race.isRaceComplete;
    if (done && !this.resultsShown) {
      this.resultsShown = true;
      sound.finish();
      setTimeout(() => this.showResults(race), 1200);
    }
  }

  private updateSounds(race: RaceSession) {
    if (race.countdownMs > 0) {
      const second = Math.ceil(race.countdownMs / 1000);
      if (second !== this.prevCountdownSecond) {
        sound.countdownTick();
        this.prevCountdownSecond = second;
      }
    } else if (this.prevCountdownSecond !== 0) {
      sound.countdownGo();
      this.prevCountdownSecond = 0;
    }

    // Once the car finishes, race.ts stops stepping its physics entirely,
    // so car.speed is frozen at whatever it was the instant it crossed the
    // line — without this check the engine kept humming at that fixed
    // pitch indefinitely instead of dying away.
    const speedRatio =
      race.started && !race.localCar.finished
        ? Math.abs(race.localCar.speed) / race.localCar.tuning.maxSpeed
        : 0;
    sound.updateEngine(speedRatio);

    if (race.localCar.lap > this.prevLap) {
      this.prevLap = race.localCar.lap;
      if (!race.localCar.finished) sound.lap();
    }
  }

  private render(race: RaceSession) {
    const ctx = this.ctx;
    // Ground truth: the canvas's actual current CSS layout size, not a
    // value derived from the backing-buffer dimensions we last set — those
    // two can drift apart for a frame or two around resize/orientation
    // events, and that drift is what makes the camera look off-center.
    const w = this.canvas.clientWidth;
    const h2 = this.canvas.clientHeight;

    ctx.save();
    applyCamera(ctx, w, h2, race.localCar.x, race.localCar.y, undefined, this.dpr);
    drawTrack(ctx, this.track, race.elapsedMs);

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
    // After the cars, so it visually passes over them instead of them
    // driving on top of it.
    drawUnderpassDeck(ctx, this.track);
    drawImpactEffects(ctx, race.impacts, race.elapsedMs);
    ctx.restore();

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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

    // Divisor tuned so the car's absolute max speed (boosted) displays as
    // exactly 100 km/h — the physics max is 460 * 1.55 boost = 713.
    const speed = Math.round(Math.abs(race.localCar.speed) / 7.13);
    const top = Math.round(race.localCar.topSpeed / 7.13);
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
    sound.stopEngine();
    sound.stopTrainRumble();
    this.canvas.classList.remove("visible");
    document.body.classList.remove("racing");

    const winner = race.results[0];
    const winnerLine = winner
      ? h("p", "winner-line", `🏆 ${winner.name} wins! ${formatTime(winner.timeMs)}`)
      : null;

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

    const actions = h(
      "div",
      "menu-actions",
      race.isHost
        ? button("Play Again", "btn btn-primary", () => {
            const hostLobby = this.activeHostLobby;
            const wasVsComputer = this.vsComputer;
            this.teardownRace();
            if (wasVsComputer) this.startVsComputer();
            else if (hostLobby) this.beginHostRace(hostLobby);
            else this.showMenu();
          })
        : h("p", "hint", "Waiting for the host to start another race, or head back to the menu."),
      button("Back to Menu", "btn btn-secondary", () => this.showMenu()),
    );

    const screen = h(
      "div",
      "screen results-screen",
      h("h2", "title", "🏁 Results"),
      winnerLine,
      list,
      actions,
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
