// Plain JS (no imports). Uses window.Phaser from the CDN build.
(function () {
  console.info("[training] script loaded");

  var TrainingScene = new Phaser.Class({
    Extends: Phaser.Scene,
    initialize: function TrainingScene() { Phaser.Scene.call(this, { key: "Training" }); },
    create: function () {
      console.info("[training] scene.create()");
      this.cameras.main.setBackgroundColor(0x0f1115);
      this.add.text(480, 60, "Training Scene Ready", {
        fontFamily: "system-ui, Arial",
        fontSize: "24px",
        color: "#e6e6e6"
      }).setOrigin(0.5, 0.5);

      // Draw a simple dot so we always see something
      var g = this.add.graphics();
      g.fillStyle(0x86efac).fillCircle(480, 270, 12);
    }
  });

  var config = {
    type: Phaser.AUTO,
    width: 960,
    height: 540,
    parent: "game",
    backgroundColor: "#0f1115",
    scene: [TrainingScene]
  };

  // Guard if Phaser failed to load
  if (!window.Phaser) {
    var el = document.getElementById("stats");
    if (el) el.textContent = "Failed to load Phaser. Check network.";
    console.error("[training] Phaser not found on window.");
    return;
  }

  new Phaser.Game(config);
})();
