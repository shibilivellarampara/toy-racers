import type { CarInput } from "./physics";
import { sound } from "./sound";

const KEY_MAP: Record<string, keyof typeof KEYS_DEFAULT> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

const KEYS_DEFAULT = { up: false, down: false, left: false, right: false };

// If the OS/browser interrupts a touch mid-press (app switch, notification,
// tab hidden) the matching pointerup/pointercancel can simply never arrive,
// which is what makes a touch control "lock" pressed forever. Every control
// registers a force-release callback here so losing focus always clears
// everything, regardless of why the normal event never showed up.
const forceReleaseCallbacks = new Set<() => void>();
function registerForceRelease(fn: () => void): () => void {
  forceReleaseCallbacks.add(fn);
  return () => forceReleaseCallbacks.delete(fn);
}
if (typeof window !== "undefined") {
  const releaseAll = () => forceReleaseCallbacks.forEach((fn) => fn());
  window.addEventListener("blur", releaseAll);
  window.addEventListener("pointercancel", releaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });
}

class TouchButton {
  private active = new Set<number>();
  readonly el: HTMLDivElement;
  private unregister: () => void;

  constructor(label: string, className: string) {
    this.el = document.createElement("div");
    this.el.className = `touch-btn ${className}`;
    this.el.textContent = label;
    this.el.style.touchAction = "none";
    const add = (e: PointerEvent) => {
      e.preventDefault();
      sound.unlock();
      this.active.add(e.pointerId);
      this.el.classList.add("pressed");
      // Guarantees pointerup/pointercancel for this pointer always land on
      // this element, even if the finger drifts off it before release —
      // without this, release() can simply never fire.
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const remove = (e: PointerEvent) => {
      this.active.delete(e.pointerId);
      if (this.active.size === 0) this.el.classList.remove("pressed");
    };
    this.el.addEventListener("pointerdown", add);
    this.el.addEventListener("pointerup", remove);
    this.el.addEventListener("pointercancel", remove);
    this.el.addEventListener("pointerleave", remove);
    this.el.addEventListener("lostpointercapture", remove);
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
    this.unregister = registerForceRelease(() => {
      this.active.clear();
      this.el.classList.remove("pressed");
    });
  }

  get pressed() {
    return this.active.size > 0;
  }

  destroy() {
    this.unregister();
  }
}

export class InputManager {
  private keys = { ...KEYS_DEFAULT };
  private touch: {
    gas: TouchButton;
    brake: TouchButton;
    left: TouchButton;
    right: TouchButton;
  };
  /** Touch control buttons, not attached to the DOM yet — the caller decides where/when. */
  readonly element: HTMLDivElement;
  enabled = true;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    this.element = document.createElement("div");
    this.element.className = "touch-controls";

    const steerWrap = document.createElement("div");
    steerWrap.className = "touch-group touch-group--left";

    const left = new TouchButton("◀", "touch-steer");
    const right = new TouchButton("▶", "touch-steer");
    steerWrap.appendChild(left.el);
    steerWrap.appendChild(right.el);

    const pedalWrap = document.createElement("div");
    pedalWrap.className = "touch-group touch-group--right";
    const brake = new TouchButton("▽", "touch-brake");
    const gas = new TouchButton("▲", "touch-gas");
    pedalWrap.appendChild(brake.el);
    pedalWrap.appendChild(gas.el);

    this.element.appendChild(steerWrap);
    this.element.appendChild(pedalWrap);

    this.touch = { gas, brake, left, right };

    if (!isTouchDevice()) {
      this.element.style.display = "none";
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = KEY_MAP[e.key];
    if (k) this.keys[k] = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = KEY_MAP[e.key];
    if (k) this.keys[k] = false;
  };

  getInput(): CarInput {
    if (!this.enabled) return { throttle: 0, steer: 0 };
    let steer = 0;
    if (this.keys.left || this.touch.left.pressed) steer -= 1;
    if (this.keys.right || this.touch.right.pressed) steer += 1;

    let throttle = 0;
    if (this.keys.up || this.touch.gas.pressed) throttle += 1;
    if (this.keys.down || this.touch.brake.pressed) throttle -= 1;

    return { throttle: clampToUnit(throttle), steer: clampToUnit(steer) };
  }

  destroy() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.touch.gas.destroy();
    this.touch.brake.destroy();
    this.touch.left.destroy();
    this.touch.right.destroy();
    this.element.remove();
  }
}

function clampToUnit(v: number) {
  return Math.max(-1, Math.min(1, v));
}

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}
