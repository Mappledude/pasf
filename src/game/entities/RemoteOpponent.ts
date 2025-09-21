import Phaser from "phaser";
import { createFighterRig, type FighterPose } from "../arena/fighterRig";

const OPPONENT_WIDTH = 28;
const OPPONENT_HEIGHT = 48;
const OPPONENT_COLOR = 0xf87171;

export class RemoteOpponent {
  readonly maxHp = 100;
  hp = this.maxHp;
  codename = "Agent";

  readonly sprite: Phaser.GameObjects.Rectangle;
  readonly body: Phaser.Physics.Arcade.Body;
  private readonly nameTag: Phaser.GameObjects.Text;
  private readonly scene: Phaser.Scene;
  private rig: ReturnType<typeof createFighterRig> | null = null;
  private rigPose: FighterPose = "idle";
  private facing: 1 | -1 = 1;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;

    this.sprite = scene.add.rectangle(x, y, OPPONENT_WIDTH, OPPONENT_HEIGHT, OPPONENT_COLOR);
    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);
    this.body.setSize(OPPONENT_WIDTH, OPPONENT_HEIGHT, true);

    this.nameTag = scene.add.text(x, y - OPPONENT_HEIGHT / 2 - 18, this.codename, {
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      color: "#fca5a5",
      stroke: "#0f1115",
      strokeThickness: 2,
    });
    this.nameTag.setOrigin(0.5);
    this.nameTag.setScrollFactor(1);
    this.nameTag.setDepth(10);

    this.sprite.setDepth(5);

    this.setActive(false);
    this.refreshRig();
  }

  setActive(active: boolean) {
    this.sprite.setVisible(active && !this.rig);
    this.nameTag.setVisible(active);
    this.body.enable = active;
    if (this.rig) {
      this.rig.setVisible(active);
      if (active) {
        this.updateRigVisual(this.rigPose);
      }
    }
  }

  setCodename(name: string | undefined) {
    if (!name) return;
    this.codename = name;
    this.nameTag.setText(name);
  }

  setState(
    state: {
      x: number;
      y: number;
      facing?: "L" | "R";
      hp?: number;
      anim?: string;
      vx?: number;
      vy?: number;
    },
  ) {
    const { x, y } = state;
    this.sprite.setPosition(x, y);
    this.body.reset(x, y);
    this.nameTag.setPosition(x, y - OPPONENT_HEIGHT / 2 - 18);

    const facing = state.facing === "L" ? -1 : 1;
    this.sprite.setScale(facing, 1);
    this.facing = facing;

    if (typeof state.hp === "number") {
      this.hp = Phaser.Math.Clamp(state.hp, 0, this.maxHp);
    }

    if (!this.sprite.visible) {
      this.setActive(true);
    }

    this.rigPose = this.resolveRigPose(state);
    this.updateRigVisual(this.rigPose);
  }

  destroy() {
    this.sprite.destroy();
    this.nameTag.destroy();
    this.rig?.destroy();
  }

  refreshRig() {
    if (this.rig) {
      this.updateRigVisual(this.rigPose);
      return true;
    }
    const rig = createFighterRig(this.scene, { tint: OPPONENT_COLOR, depth: this.sprite.depth + 1 });
    if (!rig) {
      return false;
    }
    this.rig = rig;
    this.sprite.setVisible(false);
    this.updateRigVisual(this.rigPose);
    this.rig.setVisible(this.body.enable);
    return true;
  }

  hasRig() {
    return !!this.rig;
  }

  handleTextureUpdate() {
    this.refreshRig();
  }

  private updateRigVisual(pose: FighterPose) {
    if (!this.rig) {
      return;
    }
    this.rig.setPosition(this.sprite.x, this.sprite.y);
    this.rig.setFacing(this.facing);
    this.rig.setPose(pose);
    this.rig.setVisible(this.body.enable);
  }

  private resolveRigPose(state: { hp?: number; anim?: string; vx?: number; vy?: number }): FighterPose {
    const hp = typeof state.hp === "number" ? Phaser.Math.Clamp(state.hp, 0, this.maxHp) : this.hp;
    if (hp <= 0) {
      return "ko";
    }
    if (state.anim === "attack") {
      return "punch";
    }
    if (state.anim === "hit") {
      return "hit";
    }
    const vx = state.vx ?? 0;
    const vy = state.vy ?? 0;
    if (Math.abs(vy) > 60) {
      return "jump";
    }
    if (Math.abs(vx) > 40) {
      return "run";
    }
    return "idle";
  }
}
