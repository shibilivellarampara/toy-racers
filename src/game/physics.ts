export interface CarInput {
  throttle: number; // -1 (brake/reverse) .. 1 (accelerate)
  steer: number; // -1 (left) .. 1 (right)
}

export interface CarTuning {
  maxSpeed: number;
  maxReverseSpeed: number;
  acceleration: number;
  brakeDeceleration: number;
  drag: number;
  turnRate: number; // rad/s at full steer, full speed
  grip: number; // 0..1, how fast velocity direction snaps to heading (lower = more drift)
  radius: number; // collision radius in px
}

export const DEFAULT_TUNING: CarTuning = {
  maxSpeed: 460,
  maxReverseSpeed: -180,
  acceleration: 280,
  brakeDeceleration: 480,
  drag: 1.4,
  turnRate: 3.1,
  grip: 6.5,
  radius: 16,
};

export const BOOST_DURATION = 2.5; // seconds
export const BOOST_COOLDOWN = 4; // seconds before a pad can retrigger on the same car
const BOOST_SPEED_MULT = 1.55;
const BOOST_ACCEL_MULT = 1.8;

export class Car {
  x: number;
  y: number;
  angle: number; // radians, 0 = facing +x
  vx = 0;
  vy = 0;
  speed = 0; // signed scalar along heading, derived each step

  lap = 0;
  nextCheckpoint = 0;
  finished = false;
  raceTimeMs = 0;
  tuning: CarTuning;

  topSpeed = 0;
  boostTimer = 0;
  boostCooldown = 0;

  constructor(x: number, y: number, angle: number, tuning: CarTuning = DEFAULT_TUNING) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.tuning = tuning;
  }

  reset(x: number, y: number, angle: number) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.lap = 0;
    this.nextCheckpoint = 0;
    this.finished = false;
    this.raceTimeMs = 0;
    this.topSpeed = 0;
    this.boostTimer = 0;
    this.boostCooldown = 0;
  }

  /** Grants a temporary speed/acceleration boost; safe to call repeatedly (cooldown-gated by the caller). */
  applyBoost() {
    this.boostTimer = BOOST_DURATION;
    this.boostCooldown = BOOST_COOLDOWN;
  }

  get boosting() {
    return this.boostTimer > 0;
  }

  step(dt: number, input: CarInput) {
    if (this.boostTimer > 0) this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (this.boostCooldown > 0) this.boostCooldown = Math.max(0, this.boostCooldown - dt);

    const boosted = this.boosting;
    const t: CarTuning = boosted
      ? {
          ...this.tuning,
          maxSpeed: this.tuning.maxSpeed * BOOST_SPEED_MULT,
          acceleration: this.tuning.acceleration * BOOST_ACCEL_MULT,
        }
      : this.tuning;
    const fx = Math.cos(this.angle);
    const fy = Math.sin(this.angle);

    // Signed forward speed = velocity projected onto heading.
    this.speed = this.vx * fx + this.vy * fy;

    let engineForce = 0;
    if (input.throttle > 0) {
      engineForce = t.acceleration * input.throttle;
    } else if (input.throttle < 0) {
      // Braking is stronger while moving forward, gentle reverse from a stop.
      engineForce = (this.speed > 5 ? t.brakeDeceleration : t.acceleration) * input.throttle;
    }

    this.vx += fx * engineForce * dt;
    this.vy += fy * engineForce * dt;

    // Drag (air/rolling resistance).
    const dragFactor = Math.max(0, 1 - t.drag * dt);
    this.vx *= dragFactor;
    this.vy *= dragFactor;

    this.speed = this.vx * fx + this.vy * fy;
    const clampedSpeed = clamp(this.speed, t.maxReverseSpeed, t.maxSpeed);
    if (clampedSpeed !== this.speed) {
      this.vx += fx * (clampedSpeed - this.speed);
      this.vy += fy * (clampedSpeed - this.speed);
      this.speed = clampedSpeed;
    }

    // Steering: turn heading based on speed ratio (can't pivot standing still).
    const speedRatio = clamp(this.speed / t.maxSpeed, -1, 1);
    this.angle += input.steer * t.turnRate * speedRatio * dt;

    // Grip: blend velocity vector back toward the heading direction so the
    // car doesn't drift forever, but still slides a bit through corners.
    const nfx = Math.cos(this.angle);
    const nfy = Math.sin(this.angle);
    const targetVx = nfx * this.speed;
    const targetVy = nfy * this.speed;
    const gripBlend = clamp(t.grip * dt, 0, 1);
    this.vx = lerp(this.vx, targetVx, gripBlend);
    this.vy = lerp(this.vy, targetVy, gripBlend);

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.topSpeed = Math.max(this.topSpeed, Math.abs(this.speed));
    if (!this.finished) this.raceTimeMs += dt * 1000;
  }
}

/** Pushes `car` out of `other` if they overlap; only moves `car` (each peer resolves its own car). */
/** Returns true if a collision was resolved (useful for triggering a bump sound/effect). */
export function resolveCarCollision(car: Car, other: Car): boolean {
  const dx = other.x - car.x;
  const dy = other.y - car.y;
  const dist = Math.hypot(dx, dy);
  const minDist = car.tuning.radius + other.tuning.radius;
  if (dist <= 0 || dist >= minDist) return false;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;
  car.x -= nx * overlap;
  car.y -= ny * overlap;

  const into = car.vx * nx + car.vy * ny;
  if (into > 0) {
    car.vx -= nx * into * 1.3;
    car.vy -= ny * into * 1.3;
  }
  return true;
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
