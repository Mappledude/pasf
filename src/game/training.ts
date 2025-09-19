console.info("[training] module loaded");

window.addEventListener("error", (e) => {
  console.error("[training] window error:", e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[training] unhandled promise:", e.reason);
});
import Phaser from "phaser";
import { Fireball } from "./attacks/Fireball";
import { FixedStep } from "./core/FixedStep";
import { HealthBar } from "./core/HealthBar";
import { Inputs } from "./core/Inputs";
import { Dummy } from "./entities/Dummy";
import { Player } from "./entities/Player";

interface TrainingStats {
  wins: number;
  losses: number;
}

class TrainingScene extends Phaser.Scene {
  inputs!: Inputs;
  player!: Player;
  dummy!: Dummy;

  private fixed = new FixedStep(1 / 60);
  private playerBar!: HealthBar;
  private dummyBar!: HealthBar;
  private stats: TrainingStats = { wins: 0, losses: 0 };
  private statsElement?: HTMLElement | null;
  private fireballs: Fireball[] = [];
  private fireballGroup!: Phaser.Physics.Arcade.Group;
  private flyKickTimer = 0;
  private bicycleTimer = 0;

  constructor() {
    super("Training");
  }

  preload() {
    /* no external assets */
  }

  create() {
    console.info("[training] scene.create()");
    this.inputs = new Inputs();
    this.cameras.main.setBackgroundColor(0x0f1115);
    this.physics.world.setBounds(0, 0, 960, 540);

    const ground = this.add.rectangle(480, 500, 920, 12, 0x111827);
    this.physics.add.existing(ground, true);

    const midLine = this.add.rectangle(480, 320, 4, 360, 0x111827, 0.4);
    midLine.setDepth(-1);

    this.player = new Player(this, 220, 460, this.inputs, 0x86efac);
    this.dummy = new Dummy(this, 720, 460, 0xfacc15);

    this.physics.add.collider(this.player.sprite, ground as Phaser.GameObjects.GameObject);
    this.physics.add.collider(this.dummy.sprite, ground as Phaser.GameObjects.GameObject);
    this.physics.add.collider(this.player.sprite, this.dummy.sprite);

    this.playerBar = new HealthBar(this, 20, 20);
    this.dummyBar = new HealthBar(this, 700, 20);

    this.fireballGroup = this.physics.add.group();
    this.physics.add.overlap(
      this.fireballGroup,
      this.dummy.sprite,
      (fireballObj) => {
        const projectile = this.fireballs.find((fb) => fb.sprite === fireballObj);
        if (!projectile) return;
        this.dummy.takeDamage(10);
        this.disposeFireball(projectile);
      },
      undefined,
      this,
    );

    this.statsElement = document.getElementById("stats");
  }

  update(_time: number, delta: number) {
    this.fixed.tick(delta / 1000, (dt) => {
      this.player.update(dt);
      this.dummy.update(dt);
      this.handleAttacks();
      this.handleSpecials(dt);
      this.cleanupProjectiles();
    });

    if (this.dummy.hp <= 0) {
      this.stats.wins += 1;
      this.respawn(this.dummy, 720, 460);
    }

    if (this.player.hp <= 0) {
      this.stats.losses += 1;
      this.respawn(this.player, 220, 460);
    }

    this.playerBar.draw(this.player.hp / 100);
    this.dummyBar.draw(this.dummy.hp / 100);

    if (this.statsElement) {
      this.statsElement.textContent =
        `Wins: ${this.stats.wins}  Losses: ${this.stats.losses}  ` +
        `Controls: ←/→ move, ↑ jump, ⇧ (double-tap) dash, J light, K heavy, L fireball, ` +
        `(air) ↓+J fly kick, (air) K bicycle kick`;
    }
  }

  private handleAttacks() {
    if (this.inputs.consumePress("j")) {
      this.lightAttack();
    }

    if (this.inputs.consumePress("k")) {
      this.heavyAttack();
    }

    if (this.inputs.consumePress("l")) {
      this.fireball();
    }
  }

  private handleSpecials(dt: number) {
    this.flyKickTimer = Math.max(0, this.flyKickTimer - dt);
    this.bicycleTimer = Math.max(0, this.bicycleTimer - dt);

    const downHeld = this.inputs.isDown("arrowdown") || this.inputs.isDown("s");

    if (!this.player.onGround && downHeld && this.inputs.isDown("j")) {
      const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
      if (this.flyKickTimer <= 0) {
        body.setVelocity(body.velocity.x + 120 * this.player.facing, 320);
        this.flyKickTimer = 0.15;
      }
    }

    if (!this.player.onGround && this.inputs.isDown("k")) {
      const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
      body.setVelocityY(Math.min(body.velocity.y, -40));
      if (this.bicycleTimer <= 0) {
        const aura = new Phaser.Geom.Circle(this.player.sprite.x, this.player.sprite.y, 24);
        const hit = Phaser.Geom.Intersects.CircleToRectangle(aura, this.dummy.sprite.getBounds());
        if (hit) {
          this.dummy.takeDamage(2);
        }
        const graphics = this.add.graphics();
        graphics.lineStyle(2, 0xa78bfa).strokeCircleShape(aura);
        this.time.delayedCall(60, () => graphics.destroy());
        this.bicycleTimer = 0.08;
      }
    }
  }

  private lightAttack() {
    const sprite = this.player.sprite;
    const dx = this.player.facing === 1 ? 28 : -50;
    const box = new Phaser.Geom.Rectangle(sprite.x + dx, sprite.y - 14, 44, 28);
    const hit = Phaser.Geom.Rectangle.Overlaps(box, this.dummy.sprite.getBounds());
    if (hit) {
      this.dummy.takeDamage(5);
      const body = this.dummy.sprite.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(120 * this.player.facing, -100);
    }
    this.drawBox(box, 0x34d399, 90);
  }

  private heavyAttack() {
    const sprite = this.player.sprite;
    const dx = this.player.facing === 1 ? 36 : -62;
    const box = new Phaser.Geom.Rectangle(sprite.x + dx, sprite.y - 20, 58, 40);
    const hit = Phaser.Geom.Rectangle.Overlaps(box, this.dummy.sprite.getBounds());
    if (hit) {
      this.dummy.takeDamage(15);
      const body = this.dummy.sprite.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(220 * this.player.facing, -220);
    }
    this.drawBox(box, 0xf472b6, 120);
  }

  private fireball() {
    if (this.player.fireCooldown > 0) return;
    const sprite = this.player.sprite;
    const fireball = new Fireball(this, sprite.x + 18 * this.player.facing, sprite.y - 4, this.player.facing);
    this.fireballs.push(fireball);
    this.fireballGroup.add(fireball.sprite);
    this.player.fireCooldown = 0.45;
    this.time.delayedCall(2000, () => this.disposeFireball(fireball));
  }

  private drawBox(rect: Phaser.Geom.Rectangle, color: number, duration: number) {
    const graphics = this.add.graphics();
    graphics.lineStyle(2, color).strokeRectShape(rect);
    this.time.delayedCall(duration, () => graphics.destroy());
  }

  private cleanupProjectiles() {
    for (const projectile of [...this.fireballs]) {
      if (!projectile.alive) {
        this.disposeFireball(projectile);
        continue;
      }

      if (projectile.sprite.x < -40 || projectile.sprite.x > 1000) {
        this.disposeFireball(projectile);
      }
    }
  }

  private disposeFireball(projectile: Fireball) {
    if (!projectile.alive) {
      this.removeFireball(projectile);
      return;
    }

    projectile.destroy();
    this.removeFireball(projectile);
  }

  private removeFireball(projectile: Fireball) {
    this.fireballs = this.fireballs.filter((fb) => fb !== projectile);
    if (this.fireballGroup.contains(projectile.sprite)) {
      this.fireballGroup.remove(projectile.sprite, false, false);
    }
  }

  private respawn(entity: Player | Dummy, x: number, y: number) {
    entity.healFull();
    entity.sprite.setPosition(x, y);
    const body = entity.sprite.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 540,
  backgroundColor: "#0f1115",
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 800 },
      debug: false,
    },
  },
  scene: [TrainingScene],
};

const game = new Phaser.Game(config);
(window as any).game = game;

export {};
