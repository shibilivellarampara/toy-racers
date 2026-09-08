import {
  Car,
  DEFAULT_TUNING,
  resolveCarCollision,
  resolveLineBarrier,
  resolveMutualCarCollision,
  resolveStaticCollision,
} from "./physics";
import type { InputManager } from "./input";
import { resolveTrackCollision, startPosition, updateLapProgress } from "./track";
import type { TrackDef } from "./track";
import type { NetMessage, PlayerInfo } from "../net/protocol";
import { sound } from "./sound";
import { crossingBlocking, crossingLightsActive, trainOffset } from "./crossing";
import { aiInput } from "./ai";

export interface ImpactEffect {
  x: number;
  y: number;
  atMs: number;
}

export interface RemoteCarView {
  info: PlayerInfo;
  // Normally just a render target lerped toward network state; for an AI
  // bot (isAI), this peer is the one actually stepping its physics, so it
  // holds real simulated state instead.
  car: Car;
  targetX: number;
  targetY: number;
  targetAngle: number;
  boosting: boolean;
  isAI: boolean;
}

export interface RaceResult {
  id: string;
  name: string;
  place: number;
  timeMs: number;
}

export interface StandingEntry {
  id: string;
  name: string;
  place: number;
  isLocal: boolean;
}

const COUNTDOWN_MS = 3000;
const STATE_SEND_HZ = 20;

export class RaceSession {
  readonly track: TrackDef;
  readonly localInfo: PlayerInfo;
  readonly input: InputManager;
  readonly isHost: boolean;
  readonly localCar: Car;
  readonly remotes = new Map<string, RemoteCarView>();
  results: RaceResult[] = [];

  countdownMs = 0;
  started = false;
  /** Race-wide clock, independent of any single car's finish state — this is
   * what the railway crossing's timing and every finish time is based on,
   * so they stay correct/consistent regardless of who's finished. */
  elapsedMs = 0;
  impacts: ImpactEffect[] = [];

  private readonly sendFn: (msg: NetMessage) => void;
  private finishedIds = new Set<string>();
  private placeCounter = 1;
  private sendAccumulator = 0;
  private bumpCooldown = 0;
  private wasCrossingWarning = false;
  private wasCrossingBlocking = false;
  private wasTrainPresent = false;
  private roster: PlayerInfo[];

  constructor(
    track: TrackDef,
    localInfo: PlayerInfo,
    roster: PlayerInfo[],
    input: InputManager,
    isHost: boolean,
    sendFn: (msg: NetMessage) => void,
  ) {
    this.track = track;
    this.localInfo = localInfo;
    this.input = input;
    this.isHost = isHost;
    this.sendFn = sendFn;
    this.roster = roster;

    const start = startPosition(track, localInfo.slot, Math.max(roster.length, 1));
    this.localCar = new Car(start.x, start.y, start.angle, { ...DEFAULT_TUNING });

    for (const p of roster) {
      if (p.id === localInfo.id) continue;
      this.addRemote(p);
    }
  }

  addRemote(info: PlayerInfo) {
    if (this.remotes.has(info.id)) return;
    const start = startPosition(this.track, info.slot, Math.max(this.roster.length, 1));
    const car = new Car(start.x, start.y, start.angle, { ...DEFAULT_TUNING });
    this.remotes.set(info.id, {
      info,
      car,
      targetX: start.x,
      targetY: start.y,
      targetAngle: start.angle,
      boosting: false,
      isAI: info.isAI ?? false,
    });
  }

  removeRemote(id: string) {
    this.remotes.delete(id);
  }

  startCountdown(mapId: string) {
    this.countdownMs = COUNTDOWN_MS;
    this.started = false;
    if (this.isHost) this.sendFn({ type: "countdown", ms: COUNTDOWN_MS, mapId });
  }

  /** Guests call this on receiving a host 'countdown' message. */
  beginCountdown(ms: number) {
    this.countdownMs = ms;
    this.started = false;
  }

  handleNetMessage(msg: NetMessage) {
    switch (msg.type) {
      case "state": {
        const remote = this.remotes.get(msg.id);
        if (!remote) return;
        remote.targetX = msg.x;
        remote.targetY = msg.y;
        remote.targetAngle = msg.angle;
        remote.car.lap = msg.lap;
        remote.car.nextCheckpoint = msg.cp;
        remote.boosting = msg.boost;
        if (msg.fin && this.isHost) this.checkFinish(msg.id, this.elapsedMs);
        remote.car.finished = msg.fin;
        return;
      }
      case "finish": {
        if (!this.isHost) {
          this.results = [
            ...this.results.filter((r) => r.id !== msg.id),
            { id: msg.id, name: this.nameFor(msg.id), place: msg.place, timeMs: msg.timeMs },
          ].sort((a, b) => a.place - b.place);
        }
        return;
      }
      case "countdown": {
        if (!this.isHost) this.beginCountdown(msg.ms);
        return;
      }
    }
  }

  private nameFor(id: string) {
    if (id === this.localInfo.id) return this.localInfo.name;
    return this.remotes.get(id)?.info.name ?? "Racer";
  }

  private checkFinish(id: string, timeMs: number) {
    if (this.finishedIds.has(id)) return;
    this.finishedIds.add(id);
    const place = this.placeCounter++;
    const result: RaceResult = { id, name: this.nameFor(id), place, timeMs };
    this.results = [...this.results, result].sort((a, b) => a.place - b.place);
    this.sendFn({ type: "finish", id, place, timeMs });
  }

  get isRaceComplete() {
    return this.results.length >= this.remotes.size + 1;
  }

  private updateCrossingAudio() {
    const warning = crossingLightsActive(this.elapsedMs);
    if (warning && !this.wasCrossingWarning) sound.crossingBell();
    this.wasCrossingWarning = warning;

    const blocking = crossingBlocking(this.elapsedMs);
    if (blocking && !this.wasCrossingBlocking) sound.trainHorn();
    this.wasCrossingBlocking = blocking;

    const trainPos = trainOffset(this.elapsedMs);
    const trainPresent = trainPos !== null;
    if (trainPresent && !this.wasTrainPresent) sound.startTrainRumble();
    if (trainPresent) sound.updateTrainRumble(1 - Math.abs(trainPos ?? 0));
    if (!trainPresent && this.wasTrainPresent) sound.stopTrainRumble();
    this.wasTrainPresent = trainPresent;
  }

  /** Barricades, the rail crossing gate, boost pads, and potholes — shared
   * between the local car and AI bots. Only the local car's hits make
   * noise; AI cars resolve the same physics silently. */
  private applyTrackHazards(car: Car, playSound: boolean): boolean {
    let hitSolid = false;
    for (const barricade of this.track.barricades) {
      if (resolveStaticCollision(car, barricade)) hitSolid = true;
    }
    if (crossingBlocking(this.elapsedMs)) {
      const gate = {
        x: this.track.crossing.x,
        y: this.track.crossing.y,
        angle: this.track.crossing.angle,
        halfWidth: this.track.crossing.width / 2,
        // Matches the width of the warning-stripe zone drawn at the
        // crossing (see RAIL_GAUGE in renderer.ts), not the old radius
        // reaching all the way out to the road's half-width — that had
        // the car "hitting" the gate long before it visually got there.
        halfThickness: 34,
      };
      if (resolveLineBarrier(car, gate)) hitSolid = true;
    }
    if (car.boostCooldown <= 0) {
      for (const pad of this.track.boostPads) {
        if (Math.hypot(car.x - pad.x, car.y - pad.y) <= pad.radius) {
          car.applyBoost();
          if (playSound) sound.boost();
          break;
        }
      }
    }
    if (car.potholeCooldown <= 0) {
      for (const hole of this.track.potholes) {
        if (Math.hypot(car.x - hole.x, car.y - hole.y) <= hole.radius) {
          car.hitPothole();
          if (playSound) sound.bump();
          break;
        }
      }
    }
    return hitSolid;
  }

  update(dt: number) {
    if (this.countdownMs > 0) {
      this.countdownMs = Math.max(0, this.countdownMs - dt * 1000);
      if (this.countdownMs === 0) this.started = true;
    }

    if (this.started) {
      this.elapsedMs += dt * 1000;
      this.updateCrossingAudio();
    }
    this.impacts = this.impacts.filter((imp) => this.elapsedMs - imp.atMs < 500);

    // Only the peer that created an AI bot (always the host, for now —
    // there's no networked "vs Computer" mode yet) actually simulates it;
    // anyone else just sees it as an ordinary network-driven remote and
    // lerps toward its broadcast state like any other player.
    const aiRemotes = this.isHost ? [...this.remotes.values()].filter((r) => r.isAI) : [];

    // AI bots are simulated by whichever peer created them (see ai.ts) —
    // step their physics before resolving any collisions this frame.
    if (this.started) {
      for (const remote of aiRemotes) {
        if (remote.car.finished) continue;
        const laneOffset = Math.sin(remote.info.slot * 2.4) * 0.85;
        remote.car.step(dt, aiInput(remote.car, this.track, laneOffset));
        resolveTrackCollision(remote.car, this.track);
        remote.boosting = remote.car.boosting;
      }
    }

    if (this.started && !this.localCar.finished) {
      const input = this.input.getInput();
      this.localCar.step(dt, input);
      resolveTrackCollision(this.localCar, this.track);
      this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
      let hitSomethingSolid = false;
      for (const remote of this.remotes.values()) {
        const hit =
          remote.isAI && this.isHost
            ? resolveMutualCarCollision(this.localCar, remote.car)
            : resolveCarCollision(this.localCar, remote.car);
        if (hit) hitSomethingSolid = true;
      }
      if (this.applyTrackHazards(this.localCar, true)) hitSomethingSolid = true;
      if (hitSomethingSolid && this.bumpCooldown <= 0) {
        sound.bump();
        this.impacts.push({ x: this.localCar.x, y: this.localCar.y, atMs: this.elapsedMs });
        this.bumpCooldown = 0.35;
      }
      const completedNow = updateLapProgress(this.localCar, this.track);
      if (completedNow) {
        if (this.isHost) {
          this.checkFinish(this.localInfo.id, this.elapsedMs);
        } else {
          this.sendFn({
            type: "state",
            id: this.localInfo.id,
            x: this.localCar.x,
            y: this.localCar.y,
            angle: this.localCar.angle,
            lap: this.localCar.lap,
            cp: this.localCar.nextCheckpoint,
            fin: true,
            boost: this.localCar.boosting,
          });
        }
      }
    }

    if (this.started) {
      for (let i = 0; i < aiRemotes.length; i++) {
        const remote = aiRemotes[i];
        if (remote.car.finished) continue;
        for (let j = i + 1; j < aiRemotes.length; j++) {
          if (!aiRemotes[j].car.finished) resolveMutualCarCollision(remote.car, aiRemotes[j].car);
        }
        this.applyTrackHazards(remote.car, false);
        const completedNow = updateLapProgress(remote.car, this.track);
        if (completedNow && this.isHost) this.checkFinish(remote.info.id, this.elapsedMs);
      }
    }

    for (const remote of this.remotes.values()) {
      if (remote.isAI && this.isHost) continue;
      const smoothing = Math.min(1, dt * 14);
      remote.car.x = lerp(remote.car.x, remote.targetX, smoothing);
      remote.car.y = lerp(remote.car.y, remote.targetY, smoothing);
      remote.car.angle = lerpAngle(remote.car.angle, remote.targetAngle, smoothing);
    }

    this.sendAccumulator += dt;
    const interval = 1 / STATE_SEND_HZ;
    if (this.sendAccumulator >= interval) {
      this.sendAccumulator = 0;
      this.sendFn({
        type: "state",
        id: this.localInfo.id,
        x: this.localCar.x,
        y: this.localCar.y,
        angle: this.localCar.angle,
        lap: this.localCar.lap,
        cp: this.localCar.nextCheckpoint,
        fin: this.localCar.finished,
        boost: this.localCar.boosting,
      });
      if (this.isHost) {
        for (const remote of aiRemotes) {
          this.sendFn({
            type: "state",
            id: remote.info.id,
            x: remote.car.x,
            y: remote.car.y,
            angle: remote.car.angle,
            lap: remote.car.lap,
            cp: remote.car.nextCheckpoint,
            fin: remote.car.finished,
            boost: remote.car.boosting,
          });
        }
      }
    }
  }

  getStandings(): StandingEntry[] {
    const cp = this.track.checkpointCount;
    const entries = [
      {
        id: this.localInfo.id,
        name: this.localInfo.name,
        progress: this.localCar.lap * cp + this.localCar.nextCheckpoint,
        isLocal: true,
      },
      ...[...this.remotes.values()].map((r) => ({
        id: r.info.id,
        name: r.info.name,
        progress: r.car.lap * cp + r.car.nextCheckpoint,
        isLocal: false,
      })),
    ];
    entries.sort((a, b) => b.progress - a.progress);
    return entries.map((e, i) => ({ id: e.id, name: e.name, place: i + 1, isLocal: e.isLocal }));
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
