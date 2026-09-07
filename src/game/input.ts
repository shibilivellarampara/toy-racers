import type { CarInput } from "./physics";

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

class TouchButton {
  private active = new Set<number>();
  readonly el: HTMLDivElement;

  constructor(label: string, className: string) {
    this.el = document.createElement("div");
    this.el.className = `touch-btn ${className}`;
    this.el.textContent = label;
    this.el.style.touchAction = "none";
    const add = (e: PointerEvent) => {
      e.preventDefault();
      this.active.add(e.pointerId);
      this.el.classList.add("pressed");
    };
    const remove = (e: PointerEvent) => {
      this.active.delete(e.pointerId);
      if (this.active.size === 0) this.el.classList.remove("pressed");
    };
    this.el.addEventListener("pointerdown", add);
    this.el.addEventListener("pointerup", remove);
    this.el.addEventListener("pointercancel", remove);
    this.el.addEventListener("pointerleave", remove);
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  get pressed() {
    return this.active.size > 0;
  }
}

const JOYSTICK_RADIUS = 38;

class Joystick {
  readonly el: HTMLDivElement;
  private knob: HTMLDivElement;
  private activeId: number | null = null;
  private originX = 0;
  private originY = 0;
  private value = 0; // -1..1, horizontal only

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "joystick-base";
    this.el.style.touchAction = "none";
    this.knob = document.createElement("div");
    this.knob.className = "joystick-knob";
    this.el.appendChild(this.knob);

    this.el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.activeId = e.pointerId;
      this.el.setPointerCapture(e.pointerId);
      const rect = this.el.getBoundingClientRect();
      this.originX = rect.left + rect.width / 2;
      this.originY = rect.top + rect.height / 2;
      this.updateFromEvent(e);
    });
    this.el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.activeId) return;
      this.updateFromEvent(e);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.activeId) return;
      this.activeId = null;
      this.value = 0;
      this.knob.style.transform = "translate(0px, 0px)";
    };
    this.el.addEventListener("pointerup", release);
    this.el.addEventListener("pointercancel", release);
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private updateFromEvent(e: PointerEvent) {
    let dx = e.clientX - this.originX;
    let dy = e.clientY - this.originY;
    const dist = Math.hypot(dx, dy);
    if (dist > JOYSTICK_RADIUS) {
      dx = (dx / dist) * JOYSTICK_RADIUS;
      dy = (dy / dist) * JOYSTICK_RADIUS;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.value = dx / JOYSTICK_RADIUS;
  }

  get steer() {
    return this.activeId !== null ? this.value : 0;
  }
}

export class InputManager {
  private keys = { ...KEYS_DEFAULT };
  private joystick: Joystick;
  private touch: {
    gas: TouchButton;
    brake: TouchButton;
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
    const joystick = new Joystick();
    steerWrap.appendChild(joystick.el);

    const pedalWrap = document.createElement("div");
    pedalWrap.className = "touch-group touch-group--right";
    const brake = new TouchButton("▽", "touch-brake");
    const gas = new TouchButton("▲", "touch-gas");
    pedalWrap.appendChild(brake.el);
    pedalWrap.appendChild(gas.el);

    this.element.appendChild(steerWrap);
    this.element.appendChild(pedalWrap);

    this.joystick = joystick;
    this.touch = { gas, brake };

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
    let steer = this.joystick.steer;
    if (this.keys.left) steer -= 1;
    if (this.keys.right) steer += 1;

    let throttle = 0;
    if (this.keys.up || this.touch.gas.pressed) throttle += 1;
    if (this.keys.down || this.touch.brake.pressed) throttle -= 1;

    return { throttle: clampToUnit(throttle), steer: clampToUnit(steer) };
  }

  destroy() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.element.remove();
  }
}

function clampToUnit(v: number) {
  return Math.max(-1, Math.min(1, v));
}

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}
