import type { Car, CarInput } from "./physics";
import type { TrackDef } from "./track";

const LOOKAHEAD_DIST = 140;

/**
 * Simple waypoint-following AI: steers toward a point a fixed distance
 * ahead along the centerline from the car's last-known segment, easing
 * off the throttle (and braking outright on sharp turns) when that point
 * needs a big heading change. Reuses car.segmentHint (already maintained
 * by updateLapProgress every frame) as a cheap anchor instead of doing
 * its own nearest-point search.
 *
 * laneOffset (-1..1) shifts the aim point sideways off the centerline —
 * without it every bot chases the exact same line and they spend the
 * whole race shoving each other off it instead of actually racing.
 */
export function aiInput(car: Car, track: TrackDef, laneOffset = 0): CarInput {
  const { centerline, cumLen, totalLen } = track;
  const n = centerline.length;
  const hintIdx = Math.max(0, Math.min(n - 1, car.segmentHint));
  // car.progress is the car's actual arc-length position (0..1) — using
  // the segment's *start* vertex distance here instead (cumLen[hintIdx])
  // was the bug: on a long segment the car can be hundreds of units past
  // its start, so a lookahead measured from there could already be
  // behind the car, and once it is, the AI wants to steer backward into
  // where it's already been — a self-sustaining spin.
  const targetDist = (car.progress * totalLen + LOOKAHEAD_DIST) % totalLen;

  let segIdx = hintIdx;
  for (let k = 0; k < n; k++) {
    const i = (hintIdx + k) % n;
    const segStart = cumLen[i];
    const segEnd = i + 1 < n ? cumLen[i + 1] : totalLen;
    if (targetDist >= segStart && targetDist <= segEnd) {
      segIdx = i;
      break;
    }
  }
  const a = centerline[segIdx];
  const b = centerline[(segIdx + 1) % n];
  const segStart = cumLen[segIdx];
  const segEnd = segIdx + 1 < n ? cumLen[segIdx + 1] : totalLen;
  const segT = (targetDist - segStart) / (segEnd - segStart || 1);
  let targetX = a.x + (b.x - a.x) * segT;
  let targetY = a.y + (b.y - a.y) * segT;

  if (laneOffset !== 0) {
    const outerA = track.outer[segIdx];
    const innerA = track.inner[segIdx];
    const fullWidth = Math.hypot(outerA.x - innerA.x, outerA.y - innerA.y) || 1;
    const lnx = (outerA.x - innerA.x) / fullWidth;
    const lny = (outerA.y - innerA.y) / fullWidth;
    const laneDist = laneOffset * fullWidth * 0.3;
    targetX += lnx * laneDist;
    targetY += lny * laneDist;
  }

  // Barricades sit close enough to the centerline that a bot driving
  // dead-center would otherwise plow straight into them — nudge the aim
  // point away from any that are near.
  for (const barricade of track.barricades) {
    const dx = car.x - barricade.x;
    const dy = car.y - barricade.y;
    const dist = Math.hypot(dx, dy);
    const avoidRadius = barricade.radius + 70;
    if (dist > 0 && dist < avoidRadius) {
      const push = (avoidRadius - dist) / avoidRadius;
      targetX += (dx / dist) * push * 90;
      targetY += (dy / dist) * push * 90;
    }
  }

  const targetAngle = Math.atan2(targetY - car.y, targetX - car.x);
  let diff = targetAngle - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  // A high gain here saturates steer to full lock for almost any heading
  // error, and full-lock steering at speed (turnRate has full authority
  // above ~20% of top speed) overshoots the target heading every frame
  // and never settles — the car ends up spinning in place rather than
  // smoothly correcting. Low gain trades quick correction for stability.
  const steer = Math.max(-1, Math.min(1, diff * 0.9));
  let throttle = 1;
  if (Math.abs(diff) > 1.1) throttle = 0.1; // needs to basically turn around: ease off, don't brake into reverse
  else if (Math.abs(diff) > 0.5) throttle = 0.4;

  return { throttle, steer };
}
