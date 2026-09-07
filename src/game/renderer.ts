import type { Car } from "./physics";
import type { RoundedRect, TrackDef } from "./track";

export interface RenderCar {
  car: Car;
  color: string;
  label: string;
  isLocal: boolean;
}

function roundedRectPath(ctx: CanvasRenderingContext2D, rect: RoundedRect) {
  const { cx, cy, hw, hh, r } = rect;
  ctx.beginPath();
  ctx.moveTo(cx - hw + r, cy - hh);
  ctx.lineTo(cx + hw - r, cy - hh);
  ctx.arcTo(cx + hw, cy - hh, cx + hw, cy - hh + r, r);
  ctx.lineTo(cx + hw, cy + hh - r);
  ctx.arcTo(cx + hw, cy + hh, cx + hw - r, cy + hh, r);
  ctx.lineTo(cx - hw + r, cy + hh);
  ctx.arcTo(cx - hw, cy + hh, cx - hw, cy + hh - r, r);
  ctx.lineTo(cx - hw, cy - hh + r);
  ctx.arcTo(cx - hw, cy - hh, cx - hw + r, cy - hh, r);
  ctx.closePath();
}

export function drawTrack(ctx: CanvasRenderingContext2D, track: TrackDef) {
  ctx.save();
  // grass
  ctx.fillStyle = "#1c6b3c";
  ctx.fillRect(
    track.outer.cx - track.outer.hw - 200,
    track.outer.cy - track.outer.hh - 200,
    track.outer.hw * 2 + 400,
    track.outer.hh * 2 + 400,
  );

  // track surface (outer minus inner via even-odd fill)
  ctx.fillStyle = "#3a3f4b";
  ctx.beginPath();
  roundedRectPath(ctx, track.outer);
  roundedRectPath(ctx, track.inner);
  ctx.fill("evenodd");

  // kerbs
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#e11d2e";
  ctx.setLineDash([26, 26]);
  ctx.beginPath();
  roundedRectPath(ctx, track.outer);
  ctx.stroke();
  ctx.beginPath();
  roundedRectPath(ctx, track.inner);
  ctx.stroke();
  ctx.setLineDash([]);

  // infield
  ctx.fillStyle = "#2f8f52";
  ctx.beginPath();
  roundedRectPath(ctx, track.inner);
  ctx.fill();

  // start/finish line
  drawStartLine(ctx, track);
  ctx.restore();
}

function drawStartLine(ctx: CanvasRenderingContext2D, track: TrackDef) {
  const mid = {
    hw: (track.outer.hw + track.inner.hw) / 2,
    hh: (track.outer.hh + track.inner.hh) / 2,
  };
  const x = track.centerX + Math.cos(track.startAngle) * mid.hw;
  const y = track.centerY + Math.sin(track.startAngle) * mid.hh;
  const halfLen = (track.outer.hw - track.inner.hw) / 2 + 20;
  ctx.save();
  ctx.translate(x, y);
  const squares = 8;
  const segLen = (halfLen * 2) / squares;
  for (let i = 0; i < squares; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#fff" : "#111";
    ctx.fillRect(-14, -halfLen + i * segLen, 28, segLen);
  }
  ctx.restore();
}

export function drawCar(ctx: CanvasRenderingContext2D, rc: RenderCar) {
  const { car, color } = rc;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  const len = 34;
  const wid = 18;

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
  roundRect(ctx, -len / 2, -wid / 2, len, wid, 6);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.shadowColor = "transparent";

  // cabin / windshield
  roundRect(ctx, -len * 0.06, -wid * 0.32, len * 0.4, wid * 0.64, 4);
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
  const scale = Math.min(size / (track.outer.hw * 2 + 80), size / (track.outer.hh * 2 + 80));
  const x0 = canvasWidth - size - pad;
  const y0 = pad;

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
  roundedRectPath(ctx, track.outer);
  roundedRectPath(ctx, track.inner);
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
