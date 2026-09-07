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
  ctx.restore();
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

  // wheels
  ctx.fillStyle = "#111318";
  const wheelW = 6;
  const wheelH = 10;
  ctx.fillRect(len * 0.18, -wid / 2 - 1, wheelH, wheelW);
  ctx.fillRect(len * 0.18, wid / 2 - wheelW + 1, wheelH, wheelW);
  ctx.fillRect(-len * 0.32, -wid / 2 - 1, wheelH, wheelW);
  ctx.fillRect(-len * 0.32, wid / 2 - wheelW + 1, wheelH, wheelW);

  // body
  roundRect(ctx, -len / 2, -wid / 2, len, wid, 8);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = rc.boosting ? "#7dd3fc" : "rgba(0,0,0,0.4)";
  ctx.lineWidth = rc.boosting ? 2.5 : 1.5;
  ctx.stroke();

  ctx.shadowColor = "transparent";

  // cabin / windshield
  roundRect(ctx, -len * 0.06, -wid * 0.32, len * 0.4, wid * 0.64, 5);
  ctx.fillStyle = "#12172a";
  ctx.fill();

  // nose stripe
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(len / 2 - 4, -2.5, 4, 5);

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
