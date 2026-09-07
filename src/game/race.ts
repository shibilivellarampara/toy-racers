import { Car, DEFAULT_TUNING } from "./physics";
import type { InputManager } from "./input";
import { resolveTrackCollision, startPosition, updateLapProgress } from "./track";
import type { TrackDef } from "./track";
import type { NetMessage, PlayerInfo } from "../net/protocol";

export interface RemoteCarView {
  info: PlayerInfo;
  car: Car; // used purely as a render target; not stepped through physics
  targetX: number;
  targetY: number;
  targetAngle: number;
}

export interface RaceResult {
  id: string;
  name: string;
  place: number;
  timeMs: number;
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

  private readonly sendFn: (msg: NetMessage) => void;
  private finishedIds = new Set<string>();
  private placeCounter = 1;
  private sendAccumulator = 0;
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
    this.remotes.set(info.id, { info, car, targetX: start.x, targetY: start.y, targetAngle: start.angle });
  }

  removeRemote(id: string) {
    this.remotes.delete(id);
  }

  startCountdown() {
    this.countdownMs = COUNTDOWN_MS;
    this.started = false;
    if (this.isHost) this.sendFn({ type: "countdown", ms: COUNTDOWN_MS });
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
        if (msg.fin && this.isHost) this.checkFinish(msg.id, remote.car.raceTimeMs);
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

  update(dt: number) {
    if (this.countdownMs > 0) {
      this.countdownMs = Math.max(0, this.countdownMs - dt * 1000);
      if (this.countdownMs === 0) this.started = true;
    }

    if (this.started && !this.localCar.finished) {
      const input = this.input.getInput();
      this.localCar.step(dt, input);
      resolveTrackCollision(this.localCar, this.track);
      const completedNow = updateLapProgress(this.localCar, this.track);
      if (completedNow) {
        if (this.isHost) {
          this.checkFinish(this.localInfo.id, this.localCar.raceTimeMs);
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
          });
        }
      }
    }

    for (const remote of this.remotes.values()) {
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
      });
    }
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
