import Phaser from "phaser";

export default class TrainingScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private jumpKey!: Phaser.Input.Keyboard.Key;
  private hp = 100;
  private hpText!: Phaser.GameObjects.Text;

  constructor() {
    super("Training");
  }

  preload() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1).fillRect(0, 0, 24, 24);
    g.generateTexture("playerBox", 24, 24);
    g.destroy();
  }

  create() {
    console.info("[TrainingScene] create()");
    this.cameras.main.setBackgroundColor(0x0f1115);

    this.physics.world.setBounds(0, 0, 960, 540);

    this.player = this.physics.add
      .sprite(480, 300, "playerBox")
      .setBounce(0)
      .setCollideWorldBounds(true);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.jumpKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.add.text(16, 12, "Training Scene Ready", {
      fontFamily: "system-ui, Arial",
      fontSize: "18px",
      color: "#e6e6e6",
    });

    this.hpText = this.add.text(16, 36, `HP: ${this.hp}`, {
      fontFamily: "system-ui, Arial",
      fontSize: "16px",
      color: "#86efac",
    });

    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.hp = Math.max(0, this.hp - 1);
        this.hpText.setText(`HP: ${this.hp}`);
      },
    });
  }

  update() {
    const speed = 220;

    if (this.cursors.left?.isDown) {
      this.player.setVelocityX(-speed);
    } else if (this.cursors.right?.isDown) {
      this.player.setVelocityX(speed);
    } else {
      this.player.setVelocityX(0);
    }

    const onFloor = this.player.body.blocked.down || this.player.body.touching.down;
    if (Phaser.Input.Keyboard.JustDown(this.jumpKey) && onFloor) {
      this.player.setVelocityY(-360);
    }
  }
}
