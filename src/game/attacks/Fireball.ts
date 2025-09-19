import Phaser from "phaser";

const FIREBALL_RADIUS = 6;

function ensureCircleTexture(scene: Phaser.Scene, key: string, radius: number) {
  if (scene.textures.exists(key)) return;
  const diameter = radius * 2;
  const graphics = scene.add.graphics({ x: 0, y: 0 });
  graphics.setVisible(false);
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(radius, radius, radius);
  graphics.generateTexture(key, diameter, diameter);
  graphics.destroy();
}

export class Fireball {
  sprite: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  alive = true;

  constructor(scene: Phaser.Scene, x: number, y: number, dir: 1 | -1) {
    ensureCircleTexture(scene, "fireball-circle", FIREBALL_RADIUS);
    this.sprite = scene.physics.add
      .image(x, y, "fireball-circle")
      .setTint(0x60a5fa)
      .setDepth(1);

    this.sprite.setCircle(FIREBALL_RADIUS).setOffset(-FIREBALL_RADIUS, -FIREBALL_RADIUS);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setVelocityX(260 * dir);
    body.setMaxVelocity(260, 0);
  }

  destroy() {
    this.sprite.destroy();
    this.alive = false;
  }
}
