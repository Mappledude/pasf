import Phaser from "phaser";

const BODY_RADIUS = 12;

function ensureCircleTexture(scene: Phaser.Scene, key: string, radius: number) {
  if (scene.textures.exists(key)) return;
  const diameter = radius * 2;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(radius, radius, radius);
  graphics.generateTexture(key, diameter, diameter);
  graphics.destroy();
}

export class Dummy {
  sprite: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  hp = 100;

  private direction: 1 | -1 = -1;
  private changeTimer = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, private readonly tint = 0xfacc15) {
    ensureCircleTexture(scene, "dummy-circle", BODY_RADIUS);
    this.sprite = scene.physics.add.image(x, y, "dummy-circle").setTint(tint);
    this.sprite.setCircle(BODY_RADIUS).setOffset(-BODY_RADIUS, -BODY_RADIUS);
    this.sprite.setCollideWorldBounds(true).setImmovable(false).setMaxVelocity(200, 900);
  }

  update(dt: number) {
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    const onGround = body.blocked.down;
    this.changeTimer -= dt;

    if (onGround && this.changeTimer <= 0) {
      this.changeTimer = 1.5 + Math.random();
      this.direction = Math.random() > 0.5 ? 1 : -1;
    }

    if (onGround) {
      body.setVelocityX(this.direction * 60);
    }
  }

  takeDamage(amount: number) {
    this.hp = Math.max(0, this.hp - amount);
    this.sprite.setTintFill(0xffe08a);
    window.setTimeout(() => this.sprite.setTint(this.tint), 100);
  }

  healFull() {
    this.hp = 100;
  }
}
