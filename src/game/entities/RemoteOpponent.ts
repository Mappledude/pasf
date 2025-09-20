import Phaser from "phaser";

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

  constructor(private scene: Phaser.Scene, x: number, y: number) {
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
  }

  setActive(active: boolean) {
    this.sprite.setVisible(active);
    this.nameTag.setVisible(active);
    this.body.enable = active;
  }

  setCodename(name: string | undefined) {
    if (!name) return;
    this.codename = name;
    this.nameTag.setText(name);
  }

  setState(state: { x: number; y: number; facing?: "L" | "R"; hp?: number }) {
    const { x, y } = state;
    this.sprite.setPosition(x, y);
    this.body.reset(x, y);
    this.nameTag.setPosition(x, y - OPPONENT_HEIGHT / 2 - 18);

    const facing = state.facing === "L" ? -1 : 1;
    this.sprite.setScale(facing, 1);

    if (typeof state.hp === "number") {
      this.hp = Phaser.Math.Clamp(state.hp, 0, this.maxHp);
    }

    if (!this.sprite.visible) {
      this.setActive(true);
    }
  }

  destroy() {
    this.sprite.destroy();
    this.nameTag.destroy();
  }
}
