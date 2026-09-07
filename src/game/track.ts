import type { Car } from "./physics";

export interface Point {
  x: number;
  y: number;
}

export interface BoostPad {
  x: number;
  y: number;
  radius: number;
}

export interface TrackDef {
  outer: Point[];
  inner: Point[];
  centerline: Point[];
  cumLen: number[]; // cumulative arc length at each centerline vertex
  totalLen: number;
  checkpointCount: number;
  centerX: number;
  centerY: number;
  boostPads: BoostPad[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

type Centerline = [number, number, number][];

/** Hand-authored circuit: a hairpin + a chicane between two long straights. */
const GRAND_CIRCUIT: Centerline = [
  [2300, 1450, 300], // start/finish straight, right end
  [1200, 1500, 300], // bottom straight, left end
  [700, 1400, 260], // turn 1 entry (sweeper)
  [450, 1150, 220], // turn 1 mid
  [420, 800, 260], // left side straight
  [600, 550, 220], // hairpin entry
  [480, 420, 160], // hairpin apex (narrow, technical)
  [720, 380, 200], // hairpin exit
  [1200, 420, 280], // top straight
  [1700, 380, 240], // chicane entry
  [1850, 550, 170], // chicane apex (narrow, technical)
  [1750, 700, 210], // chicane exit
  [2050, 850, 250], // right sweeper
  [2350, 1150, 280], // continue right sweeper toward start
];

/** Wide, fast, easy loop — good for a first race. */
function makeSpeedwayOval(): Centerline {
  const cx = 1400;
  const cy = 900;
  const rx = 1150;
  const ry = 680;
  const n = 20;
  const pts: Centerline = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 320]);
  }
  return pts;
}
const SPEEDWAY_OVAL = makeSpeedwayOval();

/** Tight and technical: two hairpins plus a chicane, narrower throughout. */
const TECHNICAL_TWISTER: Centerline = [
  [2150, 1500, 260], // start/finish straight
  [1300, 1520, 240], // bottom straight
  [850, 1460, 200], // turn 1 entry
  [600, 1250, 180], // hairpin 1 entry
  [560, 1000, 140], // hairpin 1 apex (narrow)
  [780, 880, 170], // hairpin 1 exit
  [1050, 950, 200], // short link straight
  [1150, 700, 180], // turn toward hairpin 2
  [950, 480, 150], // hairpin 2 entry
  [750, 400, 130], // hairpin 2 apex (narrow)
  [850, 200, 160], // hairpin 2 exit
  [1250, 160, 220], // top straight
  [1750, 200, 200], // chicane entry
  [1880, 380, 140], // chicane apex (narrow)
  [1780, 560, 190], // chicane exit
  [2100, 700, 230], // sweeper down the right side
  [2350, 1050, 260], // continue right sweeper toward start
];

interface TrackOption {
  id: string;
  name: string;
  centerline: Centerline;
  boostProgress: number[];
}

export const TRACK_LIST: TrackOption[] = [
  { id: "circuit", name: "Grand Circuit", centerline: GRAND_CIRCUIT, boostProgress: [0.04, 0.58, 0.86] },
  { id: "oval", name: "Speedway Oval", centerline: SPEEDWAY_OVAL, boostProgress: [0.1, 0.4, 0.65, 0.9] },
  {
    id: "twister",
    name: "Technical Twister",
    centerline: TECHNICAL_TWISTER,
    boostProgress: [0.03, 0.42, 0.72],
  },
];
export const DEFAULT_TRACK_ID = TRACK_LIST[0].id;

export function buildTrack(id: string): TrackDef {
  const option = TRACK_LIST.find((t) => t.id === id) ?? TRACK_LIST[0];
  return buildTrackFromCenterline(option.centerline, option.boostProgress);
}

const LAPS_TO_WIN = 3;
const CHECKPOINT_COUNT = 24;

function buildTrackFromCenterline(centerlineTriples: Centerline, boostProgress: number[]): TrackDef {
  const centerline = centerlineTriples.map(([x, y]) => ({ x, y }));
  const widths = centerlineTriples.map(([, , w]) => w);
  const n = centerline.length;

  const normals: Point[] = centerline.map((p, i) => {
    const prev = centerline[(i - 1 + n) % n];
    const next = centerline[(i + 1) % n];
    const nIn = perpUnit(prev, p);
    const nOut = perpUnit(p, next);
    let nx = nIn.x + nOut.x;
    let ny = nIn.y + nOut.y;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    return { x: nx, y: ny };
  });

  const outer: Point[] = centerline.map((p, i) => ({
    x: p.x + normals[i].x * (widths[i] / 2),
    y: p.y + normals[i].y * (widths[i] / 2),
  }));
  const inner: Point[] = centerline.map((p, i) => ({
    x: p.x - normals[i].x * (widths[i] / 2),
    y: p.y - normals[i].y * (widths[i] / 2),
  }));

  const cumLen: number[] = [0];
  for (let i = 1; i < n; i++) {
    cumLen.push(cumLen[i - 1] + dist(centerline[i - 1], centerline[i]));
  }
  const totalLen = cumLen[n - 1] + dist(centerline[n - 1], centerline[0]);

  const centerX = centerline.reduce((s, p) => s + p.x, 0) / n;
  const centerY = centerline.reduce((s, p) => s + p.y, 0) / n;

  const bounds = outer.reduce(
    (b, p) => ({
      minX: Math.min(b.minX, p.x),
      minY: Math.min(b.minY, p.y),
      maxX: Math.max(b.maxX, p.x),
      maxY: Math.max(b.maxY, p.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  const boostPads: BoostPad[] = boostProgress.map((p) => pointAtProgress(centerline, cumLen, totalLen, p, 60));

  return {
    outer,
    inner,
    centerline,
    cumLen,
    totalLen,
    checkpointCount: CHECKPOINT_COUNT,
    centerX,
    centerY,
    boostPads,
    bounds,
  };
}

function pointAtProgress(
  centerline: Point[],
  cumLen: number[],
  totalLen: number,
  progress: number,
  radius: number,
): BoostPad {
  const target = progress * totalLen;
  const n = centerline.length;
  for (let i = 0; i < n; i++) {
    const segStart = cumLen[i];
    const segEnd = i + 1 < n ? cumLen[i + 1] : totalLen;
    if (target >= segStart && target <= segEnd) {
      const a = centerline[i];
      const b = centerline[(i + 1) % n];
      const t = (target - segStart) / (segEnd - segStart || 1);
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), radius };
    }
  }
  const last = centerline[n - 1];
  return { x: last.x, y: last.y, radius };
}

function perpUnit(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Rotate edge direction -90deg so it points toward the outer edge.
  return { x: dy / len, y: -dx / len };
}

function dist(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby || 1;
  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function pointInPolygon(px: number, py: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed distance to a closed polygon: negative = inside, positive = outside. */
export function polygonSDF(px: number, py: number, poly: Point[]): number {
  let minDist = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = pointSegDist(px, py, poly[j].x, poly[j].y, poly[i].x, poly[i].y);
    if (d < minDist) minDist = d;
  }
  return pointInPolygon(px, py, poly) ? -minDist : minDist;
}

function sdfGradient(x: number, y: number, poly: Point[]): { nx: number; ny: number } {
  const eps = 0.5;
  const d0 = polygonSDF(x, y, poly);
  const dx = polygonSDF(x + eps, y, poly) - d0;
  const dy = polygonSDF(x, y + eps, poly) - d0;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: dx / len, ny: dy / len };
}

/** Keeps a car within the track ring, sliding it along the wall it hit. */
export function resolveTrackCollision(car: Car, track: TrackDef) {
  const radius = car.tuning.radius;

  const outerDist = polygonSDF(car.x, car.y, track.outer);
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

  const innerDist = polygonSDF(car.x, car.y, track.inner);
  if (innerDist < radius) {
    const push = radius - innerDist;
    const { nx, ny } = sdfGradient(car.x, car.y, track.inner);
    car.x += nx * push;
    car.y += ny * push;
    const into = -(car.vx * nx + car.vy * ny);
    if (into > 0) {
      car.vx += nx * into * 1.1;
      car.vy += ny * into * 1.1;
    }
  }
}

/** Returns this car's fractional progress (0..1) around the centerline. */
function trackProgress(track: TrackDef, x: number, y: number): number {
  const { centerline, cumLen, totalLen } = track;
  const n = centerline.length;
  let best = Infinity;
  let bestProgress = 0;
  for (let i = 0; i < n; i++) {
    const a = centerline[i];
    const b = centerline[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abLenSq = abx * abx + aby * aby || 1;
    let t = ((x - a.x) * abx + (y - a.y) * aby) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    const d = Math.hypot(x - cx, y - cy);
    if (d < best) {
      best = d;
      const segStart = cumLen[i];
      const segEnd = i + 1 < n ? cumLen[i + 1] : totalLen;
      bestProgress = (segStart + (segEnd - segStart) * t) / totalLen;
    }
  }
  return bestProgress;
}

// Half the car sprite's length: check the front bumper, not the center, so
// laps/finish register exactly when the car visually reaches the line.
const FRONT_OFFSET = 17;

/** Advances lap/checkpoint progress; returns true if this step completed the race. */
export function updateLapProgress(car: Car, track: TrackDef): boolean {
  if (car.finished) return false;
  const noseX = car.x + Math.cos(car.angle) * FRONT_OFFSET;
  const noseY = car.y + Math.sin(car.angle) * FRONT_OFFSET;
  const progress = trackProgress(track, noseX, noseY);
  const idx = Math.floor(progress * track.checkpointCount) % track.checkpointCount;

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
  const p0 = track.centerline[0];
  const p1 = track.centerline[1];
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const facing = Math.atan2(dy, dx);
  const perp = { x: dy / len, y: -dx / len };
  const spread = 36;
  const back = 46; // stagger grid rows back from the line
  const row = Math.floor(laneIndex / 2);
  const side = laneIndex % 2 === 0 ? -1 : 1;
  const lateral = side * (spread / 2 + (laneCount > 1 ? 0 : 0));
  return {
    x: p0.x - dx * 0.02 - (dx / len) * back * row + perp.x * lateral,
    y: p0.y - dy * 0.02 - (dy / len) * back * row + perp.y * lateral,
    angle: facing,
  };
}

export { LAPS_TO_WIN };
