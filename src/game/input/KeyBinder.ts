export type KeyState = { left: boolean; right: boolean; up: boolean; jump: boolean; attack: boolean; seq: number };

export function createKeyBinder(target: Window = window) {
  const state: KeyState = { left: false, right: false, up: false, jump: false, attack: false, seq: 0 };
  const set = (k: keyof KeyState, v: boolean) => {
    if ((state as any)[k] !== v) {
      (state as any)[k] = v;
      state.seq++;
    }
  };
  const down = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyA": set("left", true); break;
      case "KeyD": set("right", true); break;
      case "KeyW": set("up", true); set("jump", true); break;
      case "Space": set("jump", true); break;
      case "KeyJ": set("attack", true); break;
    }
  };
  const up = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyA": set("left", false); break;
      case "KeyD": set("right", false); break;
      case "KeyW": set("up", false); set("jump", false); break;
      case "Space": set("jump", false); break;
      case "KeyJ": set("attack", false); break;
    }
  };
  target.addEventListener("keydown", down);
  target.addEventListener("keyup", up);
  const dispose = () => {
    target.removeEventListener("keydown", down);
    target.removeEventListener("keyup", up);
  };
  return { state, dispose };
}
