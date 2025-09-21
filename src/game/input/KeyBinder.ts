import {
  clearInputSource,
  createInputSource,
  type InputState,
  type InputSource,
  updateInputSource,
} from "./inputsChannel";

export type KeyState = {
  left: boolean;
  right: boolean;
  up: boolean;
  jump: boolean;
  attack1: boolean;
  attack2: boolean;
  seq: number;
};

type MutableState = Omit<KeyState, "seq">;

function toPartialUpdate(key: keyof MutableState, value: boolean): Partial<InputState> {
  switch (key) {
    case "left":
    case "right":
    case "attack1":
    case "attack2":
      return { [key]: value } as Partial<InputState>;
    case "up":
      return { up: value };
    case "jump":
      return { jump: value };
    default:
      return {};
  }
}

export function createKeyBinder(target: Window = window) {
  const source: InputSource = createInputSource("keyboard");
  const state: KeyState = {
    left: false,
    right: false,
    up: false,
    jump: false,
    attack1: false,
    attack2: false,
    seq: 0,
  };

  const set = (k: keyof MutableState, v: boolean) => {
    if (state[k] === v) {
      return;
    }
    state[k] = v;
    state.seq += 1;
    const update = toPartialUpdate(k, v);
    if (k === "up") {
      update.jump = v;
    } else if (k === "jump") {
      update.jump = v;
    }
    updateInputSource(source, update);
  };

  const down = (e: KeyboardEvent) => {
    console.log(`[INPUT] keydown code=${e.code}`);
    if (e.code.startsWith("Arrow") || e.code === "Space") {
      e.preventDefault();
    }
    switch (e.code) {
      case "KeyA":
      case "ArrowLeft":
        set("left", true);
        break;
      case "KeyD":
      case "ArrowRight":
        set("right", true);
        break;
      case "KeyW":
      case "ArrowUp":
        set("up", true);
        set("jump", true);
        break;
      case "Space":
        set("jump", true);
        break;
      case "KeyJ":
        set("attack1", true);
        break;
      case "KeyK":
        set("attack2", true);
        break;
      default:
        break;
    }
  };

  const up = (e: KeyboardEvent) => {
    if (e.code.startsWith("Arrow") || e.code === "Space") {
      e.preventDefault();
    }
    switch (e.code) {
      case "KeyA":
      case "ArrowLeft":
        set("left", false);
        break;
      case "KeyD":
      case "ArrowRight":
        set("right", false);
        break;
      case "KeyW":
      case "ArrowUp":
        set("up", false);
        set("jump", false);
        break;
      case "Space":
        set("jump", false);
        break;
      case "KeyJ":
        set("attack1", false);
        break;
      case "KeyK":
        set("attack2", false);
        break;
      default:
        break;
    }
  };

  target.addEventListener("keydown", down, { passive: false });
  target.addEventListener("keyup", up, { passive: false });

  const dispose = () => {
    target.removeEventListener("keydown", down);
    target.removeEventListener("keyup", up);
    clearInputSource(source);
  };

  return { state, dispose };
}
