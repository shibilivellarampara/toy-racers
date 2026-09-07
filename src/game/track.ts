import { Car } from "./physics";

export interface RoundedRect {
  cx: number;
  cy: number;
  hw: number; // half width
  hh: number; // half height
  r: number; // corner radius
}

export interface TrackDef {
  outer: RoundedRect;
  inner: RoundedRect;
  checkpointCount: number;
  startAngle: number; // angle (rad, around center) where the start/finish line sits
  centerX: number;
  centerY: number;
}

export function makeOvalTrack(width: number, height: number): TrackDef {
  const centerX = width / 2;
  const centerY = height / 2;
  const outer: RoundedRect = {
    cx: centerX,
    cy: centerY,
    hw: width * 0.42,
    hh: height * 0.36,
    r: Math.min(width, height) * 0.22,
  };
  const inner: RoundedRect = {
    cx: centerX,
    cy: centerY,
    hw: outer.hw - 210,
    hh: outer.hh - 210,
    r: Math.max(20, outer.r - 90),
  };
  return {
    outer,
    inner,
    checkpointCount: 12,
    startAngle: Math.PI, // left side of the ring
    centerX,
    centerY,
  };
}

/** Signed distance from a rounded rect: negative = inside, positive = outside. */
export function roundedRectSDF(x: number, y: number, rect: RoundedRect): number {
  const dx = Math.abs(x - rect.cx) - (rect.hw - rect.r);
  const dy = Math.abs(y - rect.cy) - (rect.hh - rect.r);
  const qx = Math.max(dx, 0);
  const qy = Math.max(dy, 0);
  const outsideCorner = Math.sqrt(qx * qx + qy * qy);
  const insideMax = Math.min(Math.max(dx, dy), 0);
  return outsideCorner + insideMax - rect.r;
}

function sdfGradient(x: number, y: number, rect: RoundedRect): { nx: number; ny: number } {
  const eps = 0.5;
  const d0 = roundedRectSDF(x, y, rect);
  const dx = roundedRectSDF(x + eps, y, rect) - d0;
  const dy = roundedRectSDF(x, y + eps, rect) - d0;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: dx / len, ny: dy / len };
}

/** Keeps a car within the track ring, sliding it along the wall it hit. */
export function resolveTrackCollision(car: Car, track: TrackDef) {
  const radius = car.tuning.radius;

  const outerDist = roundedRectSDF(car.x, car.y, track.outer);
  if (outerDist > -radius) {
    const push = outerDist + radius;
    const { nx, ny } = sdfGradient(car.x, car.y, track.outer);
    car.x -= nx * push;
    car.y -= ny * push;
    const into = car.vx * nx + car.vy * ny;
    if (into > 0) {
      car.vx -= nx * into * 1.1;
      car.vy -= ny * into * 1.1;
    }
  }

  const innerDist = roundedRectSDF(car.x, car.y, track.inner);
  if (innerDist < radius) {
    const push = radius - innerDist;
    const { nx, ny } = sdfGradient(car.x, car.y, track.inner);
    // gradient points away from inner rect center when outside it; we want to push outward (away from hole)
    car.x += nx * push;
    car.y += ny * push;
    const into = -(car.vx * nx + car.vy * ny);
    if (into > 0) {
      car.vx += nx * into * 1.1;
      car.vy += ny * into * 1.1;
    }
  }
}

function angleAroundCenter(track: TrackDef, x: number, y: number) {
  return Math.atan2(y - track.centerY, x - track.centerX);
}

function checkpointIndexForAngle(track: TrackDef, angle: number) {
  const rel = normalizeAngle(angle - track.startAngle);
  const idx = Math.floor((rel / (Math.PI * 2)) * track.checkpointCount);
  return ((idx % track.checkpointCount) + track.checkpointCount) % track.checkpointCount;
}

function normalizeAngle(a: number) {
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}

const LAPS_TO_WIN = 3;

/** Advances lap/checkpoint progress; returns true if this step completed the race. */
export function updateLapProgress(car: Car, track: TrackDef): boolean {
  if (car.finished) return false;
  const angle = angleAroundCenter(track, car.x, car.y);
  const idx = checkpointIndexForAngle(track, angle);

  if (idx === car.nextCheckpoint) {
    car.nextCheckpoint = (car.nextCheckpoint + 1) % track.checkpointCount;
    if (car.nextCheckpoint === 0) {
      car.lap += 1;
      if (car.lap >= LAPS_TO_WIN) {
        car.finished = true;
        return true;
      }
    }
  }
  return false;
}

export function startPosition(track: TrackDef, laneIndex: number, laneCount: number) {
  const midR = {
    hw: (track.outer.hw + track.inner.hw) / 2,
    hh: (track.outer.hh + track.inner.hh) / 2,
  };
  const baseAngle = track.startAngle;
  const spread = 34; // px between grid slots along the straight
  const x = track.centerX + Math.cos(baseAngle) * midR.hw;
  const y =
    track.centerY +
    Math.sin(baseAngle) * midR.hh +
    (laneIndex - (laneCount - 1) / 2) * spread;
  const facing = baseAngle + Math.PI / 2; // facing "up" along the straight
  return { x, y, angle: facing };
}

export { LAPS_TO_WIN };
