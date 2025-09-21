import Phaser from "phaser";

export type FighterPose = "idle" | "run" | "jump" | "punch" | "kick" | "hit" | "ko";

export const FIGHTER_ASSET_KEYS: Record<FighterPose, string> = {
  idle: "fighter-idle",
  run: "fighter-run",
  jump: "fighter-jump",
  punch: "fighter-punch",
  kick: "fighter-kick",
  hit: "fighter-hit",
  ko: "fighter-ko",
};

export interface FighterRigOptions {
  tint?: number;
  depth?: number;
}

export interface FighterRig {
  setPose(pose: FighterPose): void;
  setFacing(facing: 1 | -1): void;
  setPosition(x: number, y: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function hasFighterSprites(scene: Phaser.Scene): boolean {
  return scene.textures.exists(FIGHTER_ASSET_KEYS.idle);
}

export function createFighterRig(scene: Phaser.Scene, options: FighterRigOptions = {}): FighterRig | null {
  if (!hasFighterSprites(scene)) {
    return null;
  }

  const sprite = scene.add.sprite(0, 0, FIGHTER_ASSET_KEYS.idle);
  sprite.setOrigin(0.5, 1);
  if (typeof options.depth === "number") {
    sprite.setDepth(options.depth);
  }
  if (typeof options.tint === "number") {
    sprite.setTint(options.tint);
  }

  let currentTextureKey = FIGHTER_ASSET_KEYS.idle;

  const applyPose = (pose: FighterPose) => {
    const requestedKey = FIGHTER_ASSET_KEYS[pose] ?? FIGHTER_ASSET_KEYS.idle;
    const nextKey = scene.textures.exists(requestedKey)
      ? requestedKey
      : scene.textures.exists(currentTextureKey)
        ? currentTextureKey
        : FIGHTER_ASSET_KEYS.idle;
    if (currentTextureKey !== nextKey) {
      sprite.setTexture(nextKey);
      currentTextureKey = nextKey;
    } else if (!scene.textures.exists(currentTextureKey)) {
      sprite.setTexture(FIGHTER_ASSET_KEYS.idle);
      currentTextureKey = FIGHTER_ASSET_KEYS.idle;
    }
  };

  return {
    setPose(pose: FighterPose) {
      applyPose(pose);
    },
    setFacing(facing: 1 | -1) {
      sprite.setFlipX(facing < 0);
    },
    setPosition(x: number, y: number) {
      sprite.setPosition(x, y);
    },
    setVisible(visible: boolean) {
      sprite.setVisible(visible);
    },
    destroy() {
      sprite.destroy();
    },
  };
}
