// Minimal Training scene: if this doesn't render, it's a path/serve issue.
import Phaser from "phaser";

console.info("[training.ts] module loaded");

class TrainingScene extends Phaser.Scene {
  constructor() { super("Training"); }
  create() {
    console.info("[training.ts] scene.create()");
    this.cameras.main.setBackgroundColor(0x0f1115);
    const text = this.add.text(480, 270, "Training Scene Ready", {
      fontFamily: "system-ui, Arial",
      fontSize: "28px",
      color: "#e6e6e6",
    }).setOrigin(0.5, 0.5);

    // draw a simple stick-figure dot so something is on screen
    const g = this.add.graphics();
    g.fillStyle(0x86efac).fillCircle(480, 360, 12);
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 540,
  scene: [TrainingScene],
  backgroundColor: "#0f1115"
};

new Phaser.Game(config);
