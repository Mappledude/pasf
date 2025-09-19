import Phaser from "phaser";

const DUMMY_WIDTH = 40;
const DUMMY_HEIGHT = 64;
const DUMMY_COLOR = 0xfacc15;
const MAX_HP = 100;

export class Dummy extends Phaser.Events.EventEmitter {
  readonly maxHp = MAX_HP;
  hp = MAX_HP;
  readonly sprite: Phaser.GameObjects.Rectangle;
  readonly body: Phaser.Physics.Arcade.StaticBody;

  constructor(private scene: Phaser.Scene, x: number, y: number) {
    super();
    this.sprite = scene.add.rectangle(x, y, DUMMY_WIDTH, DUMMY_HEIGHT, DUMMY_COLOR);
    scene.physics.add.existing(this.sprite, true);
    this.body = this.sprite.body as Phaser.Physics.Arcade.StaticBody;
    this.body.updateFromGameObject();
  }

  receiveDamage(amount: number): boolean {
    if (amount <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.emit("dummy:damaged", this.hp);
    this.flash();
    const knockedOut = this.hp <= 0;
    if (knockedOut) {
      this.emit("dummy:ko");
      this.scene.time.delayedCall(350, () => {
        if (!this.sprite.active) return;
        this.reset();
      });
    }
    return knockedOut;
  }

  reset() {
    this.hp = this.maxHp;
    this.emit("dummy:damaged", this.hp);
    this.body.updateFromGameObject();
  }

  destroy() {
    this.sprite.destroy();
    this.removeAllListeners();
  }

  private flash() {
    this.sprite.setFillStyle(0xfde68a);
    this.scene.time.delayedCall(100, () => {
      this.sprite.setFillStyle(DUMMY_COLOR);
    });
  }
}
