import type { Car } from "./physics";
import type { Point, SceneryItem, TrackDef } from "./track";
import type { ImpactEffect } from "./race";
import { crossingArmProgress, crossingLightsActive, trainOffset } from "./crossing";

export interface RenderCar {
  car: Car;
  color: string;
  label: string;
  isLocal: boolean;
  boosting: boolean;
}

function polygonPath(ctx: CanvasRenderingContext2D, pts: Point[]) {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

export function drawTrack(ctx: CanvasRenderingContext2D, track: TrackDef, elapsedMs: number) {
  ctx.save();
  // grass
  const b = track.bounds;
  ctx.fillStyle = "#1c6b3c";
  ctx.fillRect(b.minX - 250, b.minY - 250, b.maxX - b.minX + 500, b.maxY - b.minY + 500);
  drawGrassPatches(ctx, track);

  // track surface (outer minus inner via even-odd fill)
  ctx.fillStyle = "#3a3f4b";
  ctx.beginPath();
  polygonPath(ctx, track.outer);
  polygonPath(ctx, track.inner);
  ctx.fill("evenodd");

  // kerbs: real racing kerbs alternate red/white, not red/gap — layer a
  // white dashed stroke then a red one offset by one dash length.
  ctx.lineWidth = 10;
  ctx.setLineDash([26, 26]);
  for (const [color, offset] of [
    ["#ffffff", 0],
    ["#e11d2e", 26],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineDashOffset = offset;
    ctx.beginPath();
    polygonPath(ctx, track.outer);
    ctx.stroke();
    ctx.beginPath();
    polygonPath(ctx, track.inner);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // infield
  ctx.fillStyle = "#2f8f52";
  ctx.beginPath();
  polygonPath(ctx, track.inner);
  ctx.fill();

  // river after the infield fill, so it isn't painted over on the side
  // that dips into the infield — only the bridge deck (drawn later) should
  // cover it, where it crosses the actual road.
  drawRiver(ctx, track);

  drawStartLine(ctx, track);
  drawBoostPads(ctx, track);
  drawPotholes(ctx, track);
  drawBarricades(ctx, track);
  drawBridgeDeck(ctx, track);
  drawUnderpassShadow(ctx, track);
  drawCrossing(ctx, track, elapsedMs);
  drawScenery(ctx, track);
  ctx.restore();
}

function drawRiver(ctx: CanvasRenderingContext2D, track: TrackDef) {
  const { x, y, angle, width } = track.bridge;
  const perpAngle = angle + Math.PI / 2;
  const halfLen = width * 1.3 + 260;
  const riverWidth = 58;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(perpAngle);
  ctx.fillStyle = "#3b82c4";
  ctx.fillRect(-halfLen, -riverWidth / 2, halfLen * 2, riverWidth);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  const t = performance.now() / 900;
  for (let i = -halfLen; i < halfLen; i += 20) {
    const wobble = Math.sin(t + i * 0.05) * 3;
    ctx.fillRect(i, wobble - riverWidth * 0.12, 11, 3);
  }
  ctx.restore();
}

function drawBridgeDeck(ctx: CanvasRenderingContext2D, track: TrackDef) {
  const { x, y, angle, width } = track.bridge;
  const span = 78;
  const halfW = width / 2;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.fillStyle = "#8b5e34";
  ctx.fillRect(-span / 2, -halfW, span, width);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let px = -span / 2 + 6; px < span / 2; px += 10) {
    ctx.fillRect(px, -halfW, 3, width);
  }
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let px = -span / 2 + 3; px < span / 2; px += 10) {
    ctx.fillRect(px, -halfW, 2, width);
  }

  ctx.fillStyle = "#5c3d21";
  ctx.fillRect(-span / 2 - 4, -halfW - 7, span + 8, 7);
  ctx.fillRect(-span / 2 - 4, halfW, span + 8, 7);
  ctx.fillStyle = "#3f2a17";
  for (let px = -span / 2; px <= span / 2 + 1; px += span / 3) {
    ctx.fillRect(px - 2.5, -halfW - 10, 5, 10);
    ctx.fillRect(px - 2.5, halfW, 5, 10);
  }
  ctx.restore();
}

const UNDERPASS_DECK_WIDTH = 84; // how wide the overhead road is, along this road's own direction

/** The ground-level part of the underpass (shadow, hanging vines, pillar
 * bases) — drawn as part of the track, underneath the cars, since it's at
 * road level. The elevated deck itself is drawn separately, after the
 * cars, so it actually reads as passing *over* them. */
function drawUnderpassShadow(ctx: CanvasRenderingContext2D, track: TrackDef) {
  const { x, y, angle, width } = track.underpass;
  const halfW = width / 2;
  const deckWidth = UNDERPASS_DECK_WIDTH;

  // shadow this road passes through, tinted green like jungle canopy shade
  // rather than plain black
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "rgba(6,26,12,0.5)";
  ctx.fillRect(-deckWidth / 2 - 4, -halfW - 6, deckWidth + 8, width + 12);

  // vines hanging down from the canopy above, into the shaded road
  ctx.strokeStyle = "rgba(46,139,79,0.85)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (let vy = -halfW + 10; vy < halfW; vy += 26) {
    const sway = Math.sin(vy * 0.3) * 6;
    ctx.beginPath();
    ctx.moveTo(-deckWidth / 2 + 6 + sway, vy);
    ctx.quadraticCurveTo(-deckWidth / 2 + 10 + sway, vy + 10, -deckWidth / 2 + 3 + sway, vy + 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(deckWidth / 2 - 6 - sway, vy + 8);
    ctx.quadraticCurveTo(deckWidth / 2 - 10 - sway, vy + 18, deckWidth / 2 - 3 - sway, vy + 28);
    ctx.stroke();
  }

  // mossy stone pillars, planted in the jungle floor beside the road, just
  // outside the deck's own footprint (drawn below) so they peek out from
  // under it instead of being hidden underneath
  ctx.fillStyle = "#5c6a5e";
  ctx.fillRect(deckWidth / 2 + 2, -halfW - 28, 18, 24);
  ctx.fillRect(-deckWidth / 2 - 20, -halfW - 28, 18, 24);
  ctx.fillRect(deckWidth / 2 + 2, halfW + 4, 18, 24);
  ctx.fillRect(-deckWidth / 2 - 20, halfW + 4, 18, 24);
  ctx.fillStyle = "#3a9c5f";
  for (const [px, py] of [
    [deckWidth / 2 + 11, -halfW - 30],
    [-deckWidth / 2 - 11, -halfW - 30],
    [deckWidth / 2 + 11, halfW + 30],
    [-deckWidth / 2 - 11, halfW + 30],
  ]) {
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The elevated deck itself — an old timber bridge overgrown with jungle
 * vines and leaves, crossing above this road (mirrors drawBridgeDeck's
 * plank styling, just rotated: this one passes over the road instead of
 * the road passing over it). Drawn *after* the cars (see screens.ts) so it
 * visually covers them while they're underneath, with a soft drop shadow
 * so it reads as floating above the road rather than painted on it. */
export function drawUnderpassDeck(ctx: CanvasRenderingContext2D, track: TrackDef) {
  const { x, y, angle, width } = track.underpass;
  const perpAngle = angle + Math.PI / 2;
  const deckWidth = UNDERPASS_DECK_WIDTH;
  const deckSpan = width * 1.25 + 150;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(perpAngle);
  const halfSpan = deckSpan / 2;

  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 7;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = "#8b5e34";
  ctx.fillRect(-halfSpan, -deckWidth / 2, deckSpan, deckWidth);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let px = -halfSpan + 6; px < halfSpan; px += 10) {
    ctx.fillRect(px, -deckWidth / 2, 3, deckWidth);
  }
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let px = -halfSpan + 3; px < halfSpan; px += 10) {
    ctx.fillRect(px, -deckWidth / 2, 2, deckWidth);
  }
  ctx.fillStyle = "#5c3d21";
  ctx.fillRect(-halfSpan - 4, -deckWidth / 2 - 7, deckSpan + 8, 7);
  ctx.fillRect(-halfSpan - 4, deckWidth / 2, deckSpan + 8, 7);

  // leafy jungle canopy overgrowing both rails — a fixed pattern (seeded
  // off position, not the clock) so it doesn't flicker or shift frame to
  // frame
  const leafColors = ["#2e8b4f", "#3a9c5f", "#256b3f"];
  for (let px = -halfSpan + 16; px < halfSpan - 8; px += 34) {
    const seed = Math.abs(Math.sin(px * 0.11));
    ctx.fillStyle = leafColors[Math.floor(seed * 3) % 3];
    ctx.beginPath();
    ctx.ellipse(px, -deckWidth / 2 - 3, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px + 6, deckWidth / 2 + 3, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const RAIL_GAUGE = 46;

function drawCrossing(ctx: CanvasRenderingContext2D, track: TrackDef, elapsedMs: number) {
  const { x, y, angle, width } = track.crossing;
  const perpAngle = angle + Math.PI / 2;
  const railHalfLen = width * 1.2 + 220;
  const halfW = width / 2;
  const arm = crossingArmProgress(elapsedMs);
  const lightsOn = crossingLightsActive(elapsedMs);

  // rails, crossing under the road
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(perpAngle);
  ctx.fillStyle = "#7a6a4f";
  for (let i = -railHalfLen; i < railHalfLen; i += 22) {
    ctx.fillRect(i, -RAIL_GAUGE / 2 - 6, 14, RAIL_GAUGE + 12);
  }
  ctx.fillStyle = "#8b8f9a";
  ctx.fillRect(-railHalfLen, -RAIL_GAUGE / 2, railHalfLen * 2, 4);
  ctx.fillRect(-railHalfLen, RAIL_GAUGE / 2 - 4, railHalfLen * 2, 4);
  ctx.restore();

  // road-level warning stripes replacing the asphalt right at the crossing
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const crossSpan = RAIL_GAUGE + 12;
  ctx.fillStyle = "#e8c547";
  ctx.fillRect(-crossSpan / 2, -halfW, crossSpan, width);
  ctx.fillStyle = "#232629";
  for (let py = -halfW + 6; py < halfW; py += 16) {
    ctx.fillRect(-crossSpan / 2, py, crossSpan, 8);
  }
  ctx.restore();

  drawTrain(ctx, track, elapsedMs);
  drawGateAndLights(ctx, track, -1, arm, lightsOn);
  drawGateAndLights(ctx, track, 1, arm, lightsOn);
}

// The train always advances in the same direction each cycle (offset runs
// -1 -> 1 every time, never reverses), so car index 0's +local-x edge is
// always the true front of the whole train — that's where the locomotive's
// nose belongs.
function drawTrain(ctx: CanvasRenderingContext2D, track: TrackDef, elapsedMs: number) {
  const offset = trainOffset(elapsedMs);
  if (offset === null) return;
  const { x, y, angle, width } = track.crossing;
  const perpAngle = angle + Math.PI / 2;
  const halfW = width / 2;
  const travelRange = width * 1.2 + 220;
  const leadPos = offset * travelRange;
  const carLen = 46;
  const gap = 5;
  const carW = Math.max(28, halfW * 1.6);
  const carCount = 4;

  for (let i = 0; i < carCount; i++) {
    const pos = leadPos - i * (carLen + gap);
    const isLoco = i === 0;
    ctx.save();
    ctx.translate(x + Math.cos(perpAngle) * pos, y + Math.sin(perpAngle) * pos);
    ctx.rotate(perpAngle);

    // coupler bridging the gap back to the next car
    if (i < carCount - 1) {
      ctx.fillStyle = "#111318";
      ctx.fillRect(-carLen / 2 - gap, -3, gap, 6);
    }

    ctx.fillStyle = isLoco ? "#7a1f1f" : "#374151";
    roundRect(ctx, -carLen / 2, -carW / 2, carLen, carW, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, -carLen / 2, -carW / 2, carLen, carW, 6);
    ctx.stroke();

    // roof ridge line
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-carLen / 2 + 4, 0);
    ctx.lineTo(carLen / 2 - 4, 0);
    ctx.stroke();

    if (isLoco) {
      // pointed nose facing the direction of travel, plus a headlight and
      // cab windows so it reads as the front of the train
      ctx.fillStyle = "#5c1414";
      ctx.beginPath();
      ctx.moveTo(carLen / 2, -carW / 2 + 4);
      ctx.lineTo(carLen / 2 + 14, 0);
      ctx.lineTo(carLen / 2, carW / 2 - 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fef9c3";
      ctx.beginPath();
      ctx.arc(carLen / 2 + 9, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f1226";
      ctx.fillRect(carLen / 2 - 14, -carW / 2 + 5, 9, carW - 10);
    } else {
      // evenly spaced windows along the car — a glassy blue, deliberately
      // not yellow so it doesn't read as more crossing-hazard striping
      ctx.fillStyle = "#bfe0f5";
      const winCount = 4;
      const winW = 6;
      const span = carLen - 16;
      for (let w = 0; w < winCount; w++) {
        const wx = -span / 2 + (span / (winCount - 1)) * w;
        ctx.fillRect(wx - winW / 2, -carW / 2 + 5, winW, carW - 10);
      }
    }

    // wheel trucks peeking past the body's long edges
    ctx.fillStyle = "#111318";
    ctx.fillRect(-carLen * 0.28, -carW / 2 - 2, 8, 6);
    ctx.fillRect(carLen * 0.08, -carW / 2 - 2, 8, 6);
    ctx.fillRect(-carLen * 0.28, carW / 2 - 4, 8, 6);
    ctx.fillRect(carLen * 0.08, carW / 2 - 4, 8, 6);

    ctx.restore();
  }
}

function drawGateAndLights(
  ctx: CanvasRenderingContext2D,
  track: TrackDef,
  side: 1 | -1,
  arm: number,
  lightsOn: boolean,
) {
  const { x, y, angle, width } = track.crossing;
  const perpAngle = angle + Math.PI / 2;
  const halfW = width / 2;
  // Stand the post out in the grass beyond the kerb (not right on top of
  // it) so it reads as its own structure at the roadside, next to the
  // railway, instead of blending into the kerb stripe.
  const postDist = halfW + 24;
  const postX = x + Math.cos(perpAngle) * postDist * side;
  const postY = y + Math.sin(perpAngle) * postDist * side;

  // Resting ("up") the arm lies alongside the road, out of the way; fully
  // down it points from this post back toward the road's centerline,
  // blocking it. Interpolating the unit vectors (not the raw angles) and
  // re-deriving the angle avoids any wraparound sign errors.
  const upAngle = angle;
  const downAngle = side > 0 ? perpAngle + Math.PI : perpAngle;
  const ax = Math.cos(upAngle) * (1 - arm) + Math.cos(downAngle) * arm;
  const ay = Math.sin(upAngle) * (1 - arm) + Math.sin(downAngle) * arm;
  const armWorldAngle = Math.atan2(ay, ax);

  ctx.save();
  ctx.translate(postX, postY);

  // post base, wider than the old 8x8 blob so it doesn't disappear against
  // the kerb colors
  ctx.fillStyle = "#3f2a17";
  ctx.fillRect(-6, -6, 12, 12);
  ctx.fillStyle = "#5c3d21";
  ctx.fillRect(-4, -4, 8, 8);

  // blinking light on top of the post
  const blink = lightsOn && Math.sin(performance.now() / 160) > 0;
  ctx.fillStyle = "#1c1e24";
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = blink ? "#ef4444" : "rgba(120,20,20,0.5)";
  ctx.beginPath();
  ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(armWorldAngle);
  // Deliberately short of the road's centerline (rather than the old
  // halfW+14, which overshot and made both posts' arms meet mid-road as
  // one continuous line) — each arm blocks its own side, leaving them
  // visually distinct instead of reading as a single bar down the middle.
  const armLen = halfW * 0.82;
  const stripe = 12;
  for (let i = 0; i < armLen; i += stripe) {
    ctx.fillStyle = Math.floor(i / stripe) % 2 === 0 ? "#e11d2e" : "#ffffff";
    ctx.fillRect(i, -4, Math.min(stripe, armLen - i), 8);
  }
  ctx.fillStyle = "#1c1e24";
  ctx.fillRect(armLen - 2, -4.5, 3, 9);
  ctx.restore();
}

function drawBarricades(ctx: CanvasRenderingContext2D, track: TrackDef) {
  for (const b of track.barricades) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle + Math.PI / 2);
    const len = b.radius * 2;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(-len / 2, 4, len, 6);
    ctx.fillStyle = "#3f2a17";
    ctx.fillRect(-len / 2 - 4, -3, 8, 26);
    ctx.fillRect(len / 2 - 4, -3, 8, 26);
    const stripe = 12;
    for (let i = 0; i < len; i += stripe) {
      ctx.fillStyle = Math.floor(i / stripe) % 2 === 0 ? "#e11d2e" : "#ffffff";
      ctx.fillRect(-len / 2 + i, -8, Math.min(stripe, len - i), 12);
    }
    ctx.restore();
  }
}

function drawPotholes(ctx: CanvasRenderingContext2D, track: TrackDef) {
  for (const hole of track.potholes) {
    ctx.save();
    ctx.translate(hole.x, hole.y);
    ctx.rotate(hole.rotation);
    ctx.fillStyle = "#232629";
    ctx.beginPath();
    const pts = 8;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const r = hole.radius * (i % 2 === 0 ? 1 : 0.72);
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r * 0.75;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(-hole.radius * 0.15, -hole.radius * 0.12, hole.radius * 0.5, hole.radius * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawGrassPatches(ctx: CanvasRenderingContext2D, track: TrackDef) {
  for (const p of track.grassPatches) {
    const shade = p.shade >= 0 ? `rgba(255,255,255,${p.shade * 0.06})` : `rgba(0,0,0,${-p.shade * 0.08})`;
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

const ANIMAL_ROAM_RADIUS = 34;

/** Deer/elephants amble in a slow loop around their spawn point instead of
 * standing still like the trees/rocks; purely visual (no collision, no
 * network sync needed) and driven off wall-clock time so it's cheap. */
function animalOffset(item: SceneryItem): { dx: number; dy: number; heading: number } {
  const t = performance.now() / 1000;
  const wx = Math.cos(t * 0.3 + item.roamSeed);
  const wy = Math.sin(t * 0.22 + item.roamSeed * 1.7);
  const dx = wx * ANIMAL_ROAM_RADIUS;
  const dy = wy * ANIMAL_ROAM_RADIUS;
  const vx = -Math.sin(t * 0.3 + item.roamSeed) * 0.3;
  const vy = Math.cos(t * 0.22 + item.roamSeed * 1.7) * 0.22;
  return { dx, dy, heading: Math.atan2(vy, vx) };
}

function drawScenery(ctx: CanvasRenderingContext2D, track: TrackDef) {
  for (const item of track.scenery) {
    const isAnimal = item.type === "deer" || item.type === "elephant";
    const roam = isAnimal ? animalOffset(item) : null;
    ctx.save();
    ctx.translate(item.x + (roam?.dx ?? 0), item.y + (roam?.dy ?? 0));
    ctx.scale(item.scale, item.scale);
    ctx.rotate(roam ? roam.heading : item.rotation);

    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.ellipse(0, 4, item.type === "tree" ? 13 : 9, item.type === "tree" ? 5 : 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (item.type === "tree") {
      ctx.fillStyle = "#6b4423";
      ctx.fillRect(-3, -4, 6, 14);
      ctx.fillStyle = "#2e8b4f";
      ctx.beginPath();
      ctx.arc(-6, -14, 10, 0, Math.PI * 2);
      ctx.arc(6, -14, 10, 0, Math.PI * 2);
      ctx.arc(0, -21, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.arc(-3, -23, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (item.type === "bush") {
      ctx.fillStyle = "#3a9c5f";
      ctx.beginPath();
      ctx.arc(-5, 0, 7, 0, Math.PI * 2);
      ctx.arc(5, 0, 7, 0, Math.PI * 2);
      ctx.arc(0, -4, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.arc(-2, -6, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (item.type === "rock") {
      ctx.fillStyle = "#8b8f9a";
      ctx.beginPath();
      ctx.moveTo(-8, 2);
      ctx.lineTo(-5, -6);
      ctx.lineTo(3, -7);
      ctx.lineTo(8, 0);
      ctx.lineTo(4, 4);
      ctx.lineTo(-3, 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.moveTo(-5, -6);
      ctx.lineTo(3, -7);
      ctx.lineTo(0, -2);
      ctx.closePath();
      ctx.fill();
    } else if (item.type === "deer") {
      ctx.fillStyle = "#a0714a";
      ctx.fillRect(-9, -6, 16, 8); // body
      ctx.fillRect(6, -12, 6, 8); // neck/head
      ctx.fillStyle = "#6b4423";
      ctx.fillRect(-8, 2, 3, 8);
      ctx.fillRect(4, 2, 3, 8);
      // antlers
      ctx.strokeStyle = "#6b4423";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(9, -13);
      ctx.lineTo(12, -18);
      ctx.moveTo(11, -14);
      ctx.lineTo(14, -16);
      ctx.stroke();
    } else {
      // elephant
      ctx.fillStyle = "#8b93a0";
      ctx.beginPath();
      ctx.ellipse(0, -4, 16, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(12, -6, 4, 14); // trunk
      ctx.fillStyle = "#6b7280";
      ctx.beginPath();
      ctx.ellipse(-10, -10, 6, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-14, 4, 4, 9);
      ctx.fillRect(-4, 4, 4, 9);
      ctx.fillRect(6, 4, 4, 9);
    }
    ctx.restore();
  }
}

function drawStartLine(ctx: CanvasRenderingContext2D, track: TrackDef) {
  const outerP = track.outer[0];
  const innerP = track.inner[0];
  const dx = outerP.x - innerP.x;
  const dy = outerP.y - innerP.y;
  const halfWidth = Math.hypot(dx, dy) / 2;
  const angle = Math.atan2(dy, dx);
  const midx = (outerP.x + innerP.x) / 2;
  const midy = (outerP.y + innerP.y) / 2;

  ctx.save();
  ctx.translate(midx, midy);
  ctx.rotate(angle);
  const squares = 8;
  const thickness = 22;
  const segLen = (halfWidth * 2) / squares;
  for (let i = 0; i < squares; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#fff" : "#111";
    ctx.fillRect(-halfWidth + i * segLen, -thickness / 2, segLen, thickness);
  }
  ctx.restore();
}

function drawBoostPads(ctx: CanvasRenderingContext2D, track: TrackDef) {
  const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 180);
  for (const pad of track.boostPads) {
    ctx.save();
    ctx.translate(pad.x, pad.y);
    ctx.rotate(pad.angle);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#facc15";
    ctx.shadowColor = "#fde047";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(0, 0, pad.radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#78350f";
    for (const off of [-14, 0, 14]) {
      ctx.beginPath();
      ctx.moveTo(off - 8, -14);
      ctx.lineTo(off + 8, 0);
      ctx.lineTo(off - 8, 14);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

export function drawCar(ctx: CanvasRenderingContext2D, rc: RenderCar) {
  const { car, color } = rc;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  const len = 34;
  const wid = 18;

  if (rc.boosting) {
    ctx.save();
    const flicker = 0.6 + 0.4 * Math.sin(performance.now() / 40);
    ctx.globalAlpha = flicker;
    ctx.fillStyle = "#7dd3fc";
    ctx.beginPath();
    ctx.moveTo(-len / 2, -wid * 0.3);
    ctx.lineTo(-len / 2 - 24, 0);
    ctx.lineTo(-len / 2, wid * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;

  // wheels, with a small hub highlight so they don't read as flat blobs
  const wheelW = 6;
  const wheelH = 10;
  const wheelXs = [len * 0.18, -len * 0.32];
  const wheelYs = [-wid / 2 - 1, wid / 2 - wheelW + 1];
  for (const wx of wheelXs) {
    for (const wy of wheelYs) {
      ctx.fillStyle = "#111318";
      ctx.fillRect(wx, wy, wheelH, wheelW);
      ctx.fillStyle = "#3a3f4b";
      ctx.fillRect(wx + wheelH / 2 - 1, wy + 1, 2, wheelW - 2);
    }
  }

  // rear spoiler
  ctx.fillStyle = "#111318";
  ctx.fillRect(-len / 2 - 3, -wid * 0.42, 3, wid * 0.84);
  ctx.fillRect(-len / 2 - 3, -wid * 0.42, 6, 2.5);
  ctx.fillRect(-len / 2 - 3, wid * 0.42 - 2.5, 6, 2.5);

  // body
  roundRect(ctx, -len / 2, -wid / 2, len, wid, 8);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = rc.boosting ? "#7dd3fc" : "rgba(0,0,0,0.4)";
  ctx.lineWidth = rc.boosting ? 2.5 : 1.5;
  ctx.stroke();

  ctx.shadowColor = "transparent";

  // glossy highlight along the top edge, like a toy car's molded plastic sheen
  ctx.save();
  roundRect(ctx, -len / 2, -wid / 2, len, wid, 8);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.ellipse(-len * 0.05, -wid * 0.32, len * 0.55, wid * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // racing stripe down the centerline
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(-len * 0.42, -wid * 0.09, len * 0.84, wid * 0.18);

  // side mirrors
  ctx.fillStyle = "#111318";
  ctx.fillRect(len * 0.16, -wid / 2 - 3, 4, 3);
  ctx.fillRect(len * 0.16, wid / 2, 4, 3);

  // cabin / windshield
  roundRect(ctx, -len * 0.06, -wid * 0.32, len * 0.4, wid * 0.64, 5);
  ctx.fillStyle = "#12172a";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // headlights and taillights
  ctx.fillStyle = "#fef9c3";
  ctx.fillRect(len / 2 - 3, -wid * 0.36, 3, wid * 0.22);
  ctx.fillRect(len / 2 - 3, wid * 0.14, 3, wid * 0.22);
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(-len / 2, -wid * 0.32, 2.5, wid * 0.2);
  ctx.fillRect(-len / 2, wid * 0.12, 2.5, wid * 0.2);

  ctx.restore();

  // name label
  ctx.save();
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText(rc.label, car.x, car.y - 26);
  ctx.restore();
}

export function drawImpactEffects(ctx: CanvasRenderingContext2D, impacts: ImpactEffect[], elapsedMs: number) {
  for (const imp of impacts) {
    const age = elapsedMs - imp.atMs;
    const t = Math.max(0, Math.min(1, age / 500));
    if (t >= 1) continue;
    ctx.save();
    ctx.translate(imp.x, imp.y);
    ctx.globalAlpha = 1 - t;
    const spikes = 6;
    const outer = 6 + t * 20;
    const inner = 2 + t * 6;
    ctx.fillStyle = "#fde047";
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export function applyCamera(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  focusX: number,
  focusY: number,
  zoom = 1.15,
  dpr = 1,
) {
  // Resetting to plain identity here (instead of the dpr-scaled transform)
  // was the bug: canvasWidth/canvasHeight are CSS pixels, but on a HiDPI
  // phone the backing buffer is dpr times bigger, so translating by
  // canvasWidth/2 only reached 1/dpr of the way to the buffer's true
  // center — invisible on desktop (dpr~1), but a visible corner-ward drift
  // on mobile (dpr 2-3).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(canvasWidth / 2, canvasHeight / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-focusX, -focusY);
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  track: TrackDef,
  cars: RenderCar[],
) {
  const size = 140;
  const pad = 14;
  const b = track.bounds;
  const scale = Math.min(size / (b.maxX - b.minX + 80), size / (b.maxY - b.minY + 80));
  const x0 = canvasWidth - size - pad;
  const y0 = pad + 46; // leave room for the "Menu" button above

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(10,12,24,0.55)";
  roundRectFill(ctx, x0 - 6, y0 - 6, size + 12, size + 12, 10);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();

  ctx.translate(x0 + size / 2, y0 + size / 2);
  ctx.scale(scale, scale);
  ctx.translate(-track.centerX, -track.centerY);

  ctx.fillStyle = "#3a3f4b";
  ctx.beginPath();
  polygonPath(ctx, track.outer);
  polygonPath(ctx, track.inner);
  ctx.fill("evenodd");
  ctx.restore();

  for (const rc of cars) {
    const px = x0 + size / 2 + (rc.car.x - track.centerX) * scale;
    const py = y0 + size / 2 + (rc.car.y - track.centerY) * scale;
    ctx.fillStyle = rc.color;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function roundRectFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
