/**
 * Pure timing functions for the railway crossing, driven by the race's
 * elapsed clock (not per-client wall time) so every player — host and
 * guests — sees the same train at the same moment without any extra
 * network messages.
 */
export const CROSSING_CYCLE_MS = 18000;
const T_WARN = 11000; // warning lights start, gates begin lowering
const T_CLOSE_DONE = 12000; // gates fully down
const T_TRAIN_END = 16500; // train has passed, gates begin rising
const T_OPEN_DONE = 17500; // gates fully up

function phaseOf(elapsedMs: number): number {
  return ((elapsedMs % CROSSING_CYCLE_MS) + CROSSING_CYCLE_MS) % CROSSING_CYCLE_MS;
}

/** 0 = gates fully up, 1 = gates fully down. */
export function crossingArmProgress(elapsedMs: number): number {
  const phase = phaseOf(elapsedMs);
  if (phase < T_WARN) return 0;
  if (phase < T_CLOSE_DONE) return (phase - T_WARN) / (T_CLOSE_DONE - T_WARN);
  if (phase < T_TRAIN_END) return 1;
  if (phase < T_OPEN_DONE) return 1 - (phase - T_TRAIN_END) / (T_OPEN_DONE - T_TRAIN_END);
  return 0;
}

export function crossingLightsActive(elapsedMs: number): boolean {
  const phase = phaseOf(elapsedMs);
  return phase >= T_WARN && phase < T_TRAIN_END;
}

/** Gates block physically once they're more than half down. */
export function crossingBlocking(elapsedMs: number): boolean {
  return crossingArmProgress(elapsedMs) > 0.5;
}

/** -1..1 slide position of the train along the rail, or null if it's not on screen. */
export function trainOffset(elapsedMs: number): number | null {
  const phase = phaseOf(elapsedMs);
  const start = T_CLOSE_DONE - 600;
  const end = T_TRAIN_END + 600;
  if (phase < start || phase > end) return null;
  const t = (phase - start) / (end - start);
  return t * 2 - 1;
}
