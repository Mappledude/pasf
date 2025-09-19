import Phaser from "phaser";
import { Dummy } from "../entities/Dummy";
import { Player } from "../entities/Player";
import { HUD } from "../ui/HUD";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const GROUND_HEIGHT = 40;
const DAMAGE_PER_HIT = 10;

export default class TrainingScene extends Phaser.Scene {
  private player?: Player;
  private dummy?: Dummy;
  private hud?: HUD;
  private ground?: Phaser.GameObjects.Rectangle;
  private koText?: Phaser.GameObjects.Text;
  private koTween?: Phaser.Tweens.Tween;

  constructor() {
    super("Training");
  }

  create() {
    this.cameras.main.setBackgroundColor(0x0f1115);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.createGround();

    this.player = new Player(this, 240, WORLD_HEIGHT - GROUND_HEIGHT - 60);
    this.dummy = new Dummy(this, 640, WORLD_HEIGHT - GROUND_HEIGHT - 60);

    this.physics.add.collider(this.player.sprite, this.ground!);
    this.physics.add.collider(this.player.sprite, this.dummy.sprite);
    this.physics.add.collider(this.dummy.sprite, this.ground!);

    this.physics.add.overlap(
      this.player.attackHitbox,
      this.dummy.sprite,
      this.handleAttackOverlap,
      undefined,
      this,
    );

    this.hud = new HUD(this, this.player, this.dummy);
    this.createKoText();

    this.dummy.on("dummy:ko", this.flashKo, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.handleShutdown, this);
  }

  update(_: number, delta: number) {
    const dt = delta / 1000;
    this.player?.update(dt);
    this.hud?.update();
  }

  private handleAttackOverlap = () => {
    if (!this.player || !this.dummy) return;
    if (!this.player.isAttackActive()) return;
    if (!this.player.registerHit()) return;

    this.dummy.receiveDamage(DAMAGE_PER_HIT);
  };

  private createGround() {
    const groundY = WORLD_HEIGHT - GROUND_HEIGHT / 2;
    this.ground = this.add.rectangle(WORLD_WIDTH / 2, groundY, WORLD_WIDTH, GROUND_HEIGHT, 0x1f2937);
    this.physics.add.existing(this.ground, true);
    const body = this.ground.body as Phaser.Physics.Arcade.StaticBody;
    body.updateFromGameObject();
  }

  private createKoText() {
    this.koText = this.add
      .text(WORLD_WIDTH / 2, 140, "KO!", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "48px",
        color: "#f97316",
        stroke: "#0f1115",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.koText.setScrollFactor(0);
  }

  private flashKo() {
    if (!this.koText) return;
    this.koTween?.stop();
    this.koText.setAlpha(1);
    this.koText.setScale(1);
    this.koTween = this.tweens.add({
      targets: this.koText,
      alpha: 0,
      scale: 1.3,
      duration: 400,
      ease: "Quad.easeOut",
    });
  }

  private handleShutdown() {
    this.koTween?.stop();
    this.player?.destroy();
    this.player = undefined;
    this.dummy?.off("dummy:ko", this.flashKo, this);
    this.dummy?.destroy();
    this.dummy = undefined;
    this.hud?.destroy();
    this.hud = undefined;
    this.ground?.destroy();
    this.ground = undefined;
    this.koText?.destroy();
    this.koText = undefined;
  }
}
