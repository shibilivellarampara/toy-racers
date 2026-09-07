import type { Car } from "./physics";
import type { Point, TrackDef } from "./track";

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

export function drawTrack(ctx: CanvasRenderingContext2D, track: TrackDef) {
  ctx.save();
  // grass
  const b = track.bounds;
  ctx.fillStyle = "#1c6b3c";
  ctx.fillRect(b.minX - 250, b.minY - 250, b.maxX - b.minX + 500, b.maxY - b.minY + 500);
  drawGrassPatches(ctx, track);
  drawRiver(ctx, track);

  // track surface (outer minus inner via even-odd fill)
  ctx.fillStyle = "#3a3f4b";
  ctx.beginPath();
  polygonPath(ctx, track.outer);
  polygonPath(ctx, track.inner);
  ctx.fill("evenodd");

  // kerbs
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#e11d2e";
  ctx.setLineDash([26, 26]);
  ctx.beginPath();
  polygonPath(ctx, track.outer);
  ctx.stroke();
  ctx.beginPath();
  polygonPath(ctx, track.inner);
  ctx.stroke();
  ctx.setLineDash([]);

  // infield
  ctx.fillStyle = "#2f8f52";
  ctx.beginPath();
  polygonPath(ctx, track.inner);
  ctx.fill();

  drawStartLine(ctx, track);
  drawBoostPads(ctx, track);
  drawPotholes(ctx, track);
  drawBridgeDeck(ctx, track);
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

function drawScenery(ctx: CanvasRenderingContext2D, track: TrackDef) {
  for (const item of track.scenery) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.scale(item.scale, item.scale);
    ctx.rotate(item.rotation);

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
    } else {
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

export function applyCamera(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  focusX: number,
  focusY: number,
  zoom = 1.15,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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
