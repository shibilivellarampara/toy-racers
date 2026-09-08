export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  slot: number;
  /** Locally simulated by whichever peer created it (the "vs Computer"
   * mode) rather than driven by a real connection. */
  isAI?: boolean;
}

export type NetMessage =
  | { type: "hello"; player: PlayerInfo }
  | { type: "roster"; players: PlayerInfo[] }
  | { type: "countdown"; ms: number; mapId: string }
  | {
      type: "state";
      id: string;
      x: number;
      y: number;
      angle: number;
      lap: number;
      cp: number;
      fin: boolean;
      boost: boolean;
    }
  | { type: "finish"; id: string; place: number; timeMs: number }
  | { type: "leave"; id: string };

export const PLAYER_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#eab308", // yellow
  "#22c55e", // green
  "#f97316", // orange
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#ec4899", // pink
];

export function randomPlayerId() {
  return Math.random().toString(36).slice(2, 10);
}
