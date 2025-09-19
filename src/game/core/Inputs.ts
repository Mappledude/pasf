export type KeyState = Record<string, boolean>;

export class Inputs {
  private pressed = new Set<string>();
  readonly keys: KeyState = {};

  constructor() {
    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      this.keys[key] = true;
      this.pressed.add(key);
    });

    window.addEventListener("keyup", (event) => {
      const key = event.key.toLowerCase();
      this.keys[key] = false;
      this.pressed.delete(key);
    });
  }

  isDown(key: string) {
    return !!this.keys[key.toLowerCase()];
  }

  consumePress(key: string) {
    const normalized = key.toLowerCase();
    const wasPressed = this.pressed.has(normalized);
    if (wasPressed) {
      this.pressed.delete(normalized);
    }
    return wasPressed;
  }
}
