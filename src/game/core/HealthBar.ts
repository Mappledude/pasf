import Phaser from "phaser";

export class HealthBar {
  private graphics: Phaser.GameObjects.Graphics;

  constructor(
    private scene: Phaser.Scene,
    private x: number,
    private y: number,
    private width = 240,
    private height = 14,
  ) {
    this.graphics = scene.add.graphics();
    this.draw(1);
  }

  draw(ratio: number) {
    const amount = Phaser.Math.Clamp(ratio, 0, 1);
    this.graphics.clear();
    this.graphics.fillStyle(0x222831).fillRect(this.x, this.y, this.width, this.height);
    this.graphics
      .fillStyle(0x22c55e)
      .fillRect(this.x + 1, this.y + 1, (this.width - 2) * amount, this.height - 2);
    this.graphics.lineStyle(1, 0x111827).strokeRect(this.x, this.y, this.width, this.height);
  }
}
