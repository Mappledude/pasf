import Phaser from "phaser";

export const KEY_A = Phaser.Input.Keyboard.KeyCodes.A;
export const KEY_D = Phaser.Input.Keyboard.KeyCodes.D;
export const KEY_W = Phaser.Input.Keyboard.KeyCodes.W;
export const KEY_SPACE = Phaser.Input.Keyboard.KeyCodes.SPACE;
export const KEY_J = Phaser.Input.Keyboard.KeyCodes.J;

export interface TrainingControls {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  jump: Phaser.Input.Keyboard.Key[];
  attack: Phaser.Input.Keyboard.Key;
}

export function bindTrainingControls(
  keyboard: Phaser.Input.Keyboard.KeyboardPlugin,
): TrainingControls {
  return {
    left: keyboard.addKey(KEY_A, false, false),
    right: keyboard.addKey(KEY_D, false, false),
    jump: [keyboard.addKey(KEY_W, false, false), keyboard.addKey(KEY_SPACE, false, false)],
    attack: keyboard.addKey(KEY_J, false, false),
  };
}

export function unbindTrainingControls(controls: TrainingControls) {
  controls.left.destroy();
  controls.right.destroy();
  controls.jump.forEach((key) => key.destroy());
  controls.attack.destroy();
}
