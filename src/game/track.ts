import type { Car } from "./physics";

export interface Point {
  x: number;
  y: number;
}

export interface BoostPad {
  x: number;
  y: number;
  radius: number;
  angle: number; // track direction here, so the chevrons point the right way
}

export interface Pothole {
  x: number;
  y: number;
  radius: number;
  rotation: number;
}

export interface SceneryItem {
  x: number;
  y: number;
  type: "tree" | "bush" | "rock" | "deer" | "elephant";
  scale: number;
  rotation: number;
  // Only animals use this — a per-item random phase so deer/elephants
  // wander around their spawn point instead of sitting still like the
  // trees/bushes/rocks.
  roamSeed: number;
}

export interface GrassPatch {
  x: number;
  y: number;
  r: number;
  shade: number; // -1..1, darker/lighter than the base grass color
}

export interface Barricade {
  x: number;
  y: number;
  radius: number;
  angle: number; // orientation across the track, for rendering
}

export interface CrossingDef {
  x: number;
  y: number;
  angle: number; // track direction at that point
  width: number;
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
  potholes: Pothole[];
  barricades: Barricade[];
  scenery: SceneryItem[];
  grassPatches: GrassPatch[];
  bridge: { x: number; y: number; angle: number; width: number };
  crossing: CrossingDef;
  underpass: { x: number; y: number; angle: number; width: number };
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

interface BarricadeSpec {
  progress: number;
  side: 1 | -1;
}

interface TrackOption {
  id: string;
  name: string;
  centerline: Centerline;
  boostProgress: number[];
  potholeProgress: number[];
  bridgeProgress: number;
  crossingProgress: number;
  underpassProgress: number;
  barricades: BarricadeSpec[];
}

export const TRACK_LIST: TrackOption[] = [
  {
    id: "circuit",
    name: "Grand Circuit",
    centerline: GRAND_CIRCUIT,
    boostProgress: [0.04, 0.58, 0.86],
    potholeProgress: [0.2, 0.48, 0.75, 0.93],
    bridgeProgress: 0.31,
    crossingProgress: 0.4,
    // On the start/finish straight, well clear of the barricade at 0.12,
    // with turn 1 starting right after it at progress ~0.2 — a straight
    // stretch immediately followed by a turn.
    underpassProgress: 0.16,
    barricades: [
      { progress: 0.12, side: 1 },
      { progress: 0.66, side: -1 },
    ],
  },
  {
    id: "oval",
    name: "Speedway Oval",
    centerline: SPEEDWAY_OVAL,
    boostProgress: [0.1, 0.4, 0.65, 0.9],
    potholeProgress: [0.25, 0.52, 0.78],
    bridgeProgress: 0.5,
    crossingProgress: 0.97,
    // On the back straightaway approaching the tight turn at its left tip
    // (progress 0.5) — this wide oval's straights sit at the ends of its
    // minor axis, not its major axis, so the flat run is top/bottom and
    // the tight turns are at the left/right tips.
    underpassProgress: 0.43,
    barricades: [
      { progress: 0.17, side: 1 },
      { progress: 0.58, side: -1 },
    ],
  },
  {
    id: "twister",
    name: "Technical Twister",
    centerline: TECHNICAL_TWISTER,
    boostProgress: [0.03, 0.42, 0.72],
    potholeProgress: [0.18, 0.55, 0.85],
    // This track's hairpins loop back close to themselves almost
    // everywhere, so the river's reach (~500-600px either side of the
    // bridge) crossed over other parts of the road except right near the
    // start/finish straight — that was the "rivers inside the race"
    // problem. 0.38 (used to sit right next to hairpin 1) is replaced
    // with a spot on the straight that has real clearance.
    bridgeProgress: 0.055,
    crossingProgress: 0.28,
    // On the start/finish straight, well before turn 1 starts at
    // progress ~0.14.
    underpassProgress: 0.09,
    barricades: [
      { progress: 0.63, side: 1 },
      { progress: 0.94, side: -1 },
    ],
  },
];
export const DEFAULT_TRACK_ID = TRACK_LIST[0].id;

export function buildTrack(id: string): TrackDef {
  const option = TRACK_LIST.find((t) => t.id === id) ?? TRACK_LIST[0];
  return buildTrackFromCenterline(option);
}

const LAPS_TO_WIN = 3;
const CHECKPOINT_COUNT = 24;

function buildTrackFromCenterline(option: TrackOption): TrackDef {
  const {
    centerline: centerlineTriples,
    boostProgress,
    potholeProgress,
    bridgeProgress,
    crossingProgress,
    underpassProgress,
    barricades: barricadeSpecs,
  } = option;
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
  const potholes: Pothole[] = potholeProgress.map((p) => {
    const pt = pointAtProgress(centerline, cumLen, totalLen, p, 26);
    return { ...pt, rotation: Math.random() * Math.PI * 2 };
  });
  const bridgePt = trackPointAtProgress(centerline, normals, widths, cumLen, totalLen, bridgeProgress);
  const bridge = { x: bridgePt.x, y: bridgePt.y, angle: bridgePt.angle, width: bridgePt.width };
  const crossingPt = trackPointAtProgress(centerline, normals, widths, cumLen, totalLen, crossingProgress);
  const crossing = { x: crossingPt.x, y: crossingPt.y, angle: crossingPt.angle, width: crossingPt.width };
  const underpassPt = trackPointAtProgress(centerline, normals, widths, cumLen, totalLen, underpassProgress);
  const underpass = { x: underpassPt.x, y: underpassPt.y, angle: underpassPt.angle, width: underpassPt.width };
  const barricades: Barricade[] = barricadeSpecs.map((spec) => {
    const p = trackPointAtProgress(centerline, normals, widths, cumLen, totalLen, spec.progress);
    const offset = spec.side * p.width * 0.28;
    return {
      x: p.x + p.nx * offset,
      y: p.y + p.ny * offset,
      radius: Math.max(18, p.width * 0.22),
      angle: p.angle,
    };
  });
  const scenery = generateScenery(outer, inner, bounds);
  const grassPatches = generateGrassPatches(bounds);

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
    potholes,
    barricades,
    scenery,
    grassPatches,
    bridge,
    crossing,
    underpass,
    bounds,
  };
}

interface TrackPoint {
  x: number;
  y: number;
  angle: number;
  width: number;
  nx: number;
  ny: number;
}

/** Interpolated position/direction/width/normal at an arbitrary point along the loop. */
function trackPointAtProgress(
  centerline: Point[],
  normals: Point[],
  widths: number[],
  cumLen: number[],
  totalLen: number,
  progress: number,
): TrackPoint {
  const target = progress * totalLen;
  const n = centerline.length;
  for (let i = 0; i < n; i++) {
    const segStart = cumLen[i];
    const segEnd = i + 1 < n ? cumLen[i + 1] : totalLen;
    if (target >= segStart && target <= segEnd) {
      const a = centerline[i];
      const b = centerline[(i + 1) % n];
      const t = (target - segStart) / (segEnd - segStart || 1);
      const width = lerp(widths[i], widths[(i + 1) % n], t);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const na = normals[i];
      const nb = normals[(i + 1) % n];
      const nx = lerp(na.x, nb.x, t);
      const ny = lerp(na.y, nb.y, t);
      const nlen = Math.hypot(nx, ny) || 1;
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), angle, width, nx: nx / nlen, ny: ny / nlen };
    }
  }
  const last = centerline[n - 1];
  const ln = normals[n - 1];
  return { x: last.x, y: last.y, angle: 0, width: widths[n - 1], nx: ln.x, ny: ln.y };
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function generateScenery(outer: Point[], inner: Point[], bounds: Bounds): SceneryItem[] {
  const items: SceneryItem[] = [];
  // Weighted toward trees so the surroundings read as a proper treeline
  // rather than a sparse scatter of mixed props.
  const weightedTypes: SceneryItem["type"][] = [
    "tree",
    "tree",
    "tree",
    "tree",
    "bush",
    "bush",
    "rock",
    "deer",
    "elephant",
  ];
  const randomItem = (x: number, y: number): SceneryItem => ({
    x,
    y,
    type: weightedTypes[Math.floor(Math.random() * weightedTypes.length)],
    scale: 0.7 + Math.random() * 0.9,
    rotation: Math.random() * Math.PI * 2,
    roamSeed: Math.random() * 1000,
  });

  // Outside the track, in the surrounding grass.
  for (let i = 0; i < 220; i++) {
    const x = bounds.minX - 220 + Math.random() * (bounds.maxX - bounds.minX + 440);
    const y = bounds.minY - 220 + Math.random() * (bounds.maxY - bounds.minY + 440);
    const d = polygonSDF(x, y, outer);
    if (d > 45 && d < 420) items.push(randomItem(x, y));
  }

  // In the infield, inside the inner hole.
  for (let i = 0; i < 80; i++) {
    const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
    const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
    const d = polygonSDF(x, y, inner);
    if (d < -45) items.push(randomItem(x, y));
  }

  return items;
}

function generateGrassPatches(bounds: Bounds): GrassPatch[] {
  const patches: GrassPatch[] = [];
  for (let i = 0; i < 26; i++) {
    patches.push({
      x: bounds.minX - 220 + Math.random() * (bounds.maxX - bounds.minX + 440),
      y: bounds.minY - 220 + Math.random() * (bounds.maxY - bounds.minY + 440),
      r: 90 + Math.random() * 160,
      shade: Math.random() * 2 - 1,
    });
  }
  return patches;
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
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), radius, angle };
    }
  }
  const last = centerline[n - 1];
  return { x: last.x, y: last.y, radius, angle: 0 };
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

const SEGMENT_LOOKBEHIND = 2;
const SEGMENT_LOOKAHEAD = 2;

/**
 * Returns this car's fractional progress (0..1) around the centerline,
 * searching only a small window of segments near `hint` (the car's last
 * known segment) rather than the whole track. A global nearest-point
 * search can jump to a spatially-close-but-arc-length-far segment on
 * hairpins/chicanes where the track passes near itself, which caused laps
 * to complete early; a local window can't do that since neighboring
 * segments are, by construction, actually adjacent on the track.
 */
function trackProgress(
  track: TrackDef,
  x: number,
  y: number,
  hint: number,
): { progress: number; segmentIndex: number } {
  const { centerline, cumLen, totalLen } = track;
  const n = centerline.length;
  let best = Infinity;
  let bestProgress = 0;
  let bestIndex = hint;
  for (let offset = -SEGMENT_LOOKBEHIND; offset <= SEGMENT_LOOKAHEAD; offset++) {
    const i = (((hint + offset) % n) + n) % n;
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
      bestIndex = i;
      const segStart = cumLen[i];
      const segEnd = i + 1 < n ? cumLen[i + 1] : totalLen;
      bestProgress = (segStart + (segEnd - segStart) * t) / totalLen;
    }
  }
  return { progress: bestProgress, segmentIndex: bestIndex };
}

// Half the car sprite's length: check the front bumper, not the center, so
// laps/finish register exactly when the car visually reaches the line.
const FRONT_OFFSET = 17;

/** Advances lap/checkpoint progress; returns true if this step completed the race. */
export function updateLapProgress(car: Car, track: TrackDef): boolean {
  if (car.finished) return false;
  const noseX = car.x + Math.cos(car.angle) * FRONT_OFFSET;
  const noseY = car.y + Math.sin(car.angle) * FRONT_OFFSET;
  const { progress, segmentIndex } = trackProgress(track, noseX, noseY, car.segmentHint);
  car.segmentHint = segmentIndex;
  car.progress = progress;
  const idx = Math.floor(progress * track.checkpointCount) % track.checkpointCount;

  if (idx === car.nextCheckpoint) {
    // Completing checkpoint 0 itself (not "checkpoint N-1 advancing to 0")
    // is what finishes a lap — otherwise reaching the last checkpoint's
    // zone (still ~1 checkpoint-width before the line) finished the lap
    // early, which is also why the race used to end before the line.
    const completingLap = car.nextCheckpoint === 0;
    car.nextCheckpoint = (car.nextCheckpoint + 1) % track.checkpointCount;
    if (completingLap) {
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
