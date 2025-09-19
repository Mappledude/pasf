import Phaser from "phaser";
import { Dummy } from "../entities/Dummy";
import { Player } from "../entities/Player";

const HUD_WIDTH = 240;
const HUD_HEIGHT = 70;
const BAR_WIDTH = 200;
const BAR_HEIGHT = 12;

export class HUD {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly debugText: Phaser.GameObjects.Text;

  constructor(
    private scene: Phaser.Scene,
    private player: Player,
    private dummy: Dummy,
  ) {
    this.graphics = scene.add.graphics({ x: 16, y: 16 });
    this.graphics.setScrollFactor(0);

    this.debugText = scene.add.text(16, 16 + HUD_HEIGHT, "", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#cbd5f5",
    });
    this.debugText.setScrollFactor(0);
  }

  update() {
    const playerRatio = Phaser.Math.Clamp(this.player.hp / this.player.maxHp, 0, 1);
    const dummyRatio = Phaser.Math.Clamp(this.dummy.hp / this.dummy.maxHp, 0, 1);

    this.graphics.clear();
    this.graphics.fillStyle(0x0f172a, 0.85);
    this.graphics.fillRoundedRect(0, 0, HUD_WIDTH, HUD_HEIGHT, 8);

    this.graphics.fillStyle(0x1e293b, 1);
    this.graphics.fillRoundedRect(20, 16, BAR_WIDTH, BAR_HEIGHT, 6);
    this.graphics.fillRoundedRect(20, 40, BAR_WIDTH, BAR_HEIGHT, 6);

    this.graphics.fillStyle(0x38bdf8, 1);
    this.graphics.fillRoundedRect(20, 16, BAR_WIDTH * playerRatio, BAR_HEIGHT, 6);

    this.graphics.fillStyle(0xfacc15, 1);
    this.graphics.fillRoundedRect(20, 40, BAR_WIDTH * dummyRatio, BAR_HEIGHT, 6);

    const fps = this.scene.game.loop.actualFps;
    const { x, y } = this.player.sprite;
    this.debugText.setText(
      [`Player HP: ${this.player.hp}`, `Dummy HP: ${this.dummy.hp}`, `FPS: ${fps.toFixed(0)}`, `Pos: ${x.toFixed(1)}, ${y.toFixed(1)}`].join("\n"),
    );
  }

  destroy() {
    this.graphics.destroy();
    this.debugText.destroy();
  }
}
