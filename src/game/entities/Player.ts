import Phaser from "phaser";
import { Inputs } from "../core/Inputs";

const BODY_RADIUS = 12;
const DASH_GAP = 0.25;
const DASH_DURATION = 0.18;
const DASH_SPEED = 360;

function ensureCircleTexture(scene: Phaser.Scene, key: string, radius: number) {
  if (scene.textures.exists(key)) return;
  const diameter = radius * 2;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(radius, radius, radius);
  graphics.generateTexture(key, diameter, diameter);
  graphics.destroy();
}

export class Player {
  sprite: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  facing: 1 | -1 = 1;
  hp = 100;
  invulnTimer = 0;
  onGround = false;
  fireCooldown = 0;

  private elapsed = 0;
  private dashTimer = 0;
  private lastTapLeft = -Infinity;
  private lastTapRight = -Infinity;

  constructor(
    private scene: Phaser.Scene,
    x: number,
    y: number,
    private inputs: Inputs,
    private readonly tint = 0xffffff,
  ) {
    ensureCircleTexture(scene, "player-circle", BODY_RADIUS);
    this.sprite = scene.physics.add.image(x, y, "player-circle").setTint(this.tint);
    this.sprite.setCircle(BODY_RADIUS).setOffset(-BODY_RADIUS, -BODY_RADIUS);
    this.sprite
      .setBounce(0)
      .setDrag(1200, 0)
      .setFriction(0, 0)
      .setCollideWorldBounds(true)
      .setMaxVelocity(320, 900);
  }

  update(dt: number) {
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.elapsed += dt;
    this.onGround = body.blocked.down;

    const leftDown = this.inputs.isDown("arrowleft") || this.inputs.isDown("a");
    const rightDown = this.inputs.isDown("arrowright") || this.inputs.isDown("d");

    const leftPressed =
      this.inputs.consumePress("arrowleft") || this.inputs.consumePress("a");
    const rightPressed =
      this.inputs.consumePress("arrowright") || this.inputs.consumePress("d");

    if (leftDown && !rightDown) {
      this.facing = -1;
    } else if (rightDown && !leftDown) {
      this.facing = 1;
    }

    if (this.onGround) {
      if (leftPressed) {
        this.handleDash(-1, body);
      }
      if (rightPressed) {
        this.handleDash(1, body);
      }
    }

    const walkSpeed = 180;
    let vx = 0;
    if (leftDown && !rightDown) {
      vx = -walkSpeed;
    } else if (rightDown && !leftDown) {
      vx = walkSpeed;
    }

    if (this.dashTimer > 0) {
      this.dashTimer = Math.max(0, this.dashTimer - dt);
      body.setVelocityX(this.facing * DASH_SPEED);
    } else {
      body.setVelocityX(vx);
    }

    const wantJump = this.inputs.isDown("arrowup") || this.inputs.isDown("w");
    if (wantJump && this.onGround) {
      body.setVelocityY(-360);
    }

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
  }

  private handleDash(direction: 1 | -1, body: Phaser.Physics.Arcade.Body) {
    const now = this.elapsed;
    if (direction === -1) {
      if (now - this.lastTapLeft <= DASH_GAP) {
        this.triggerDash(direction, body);
      }
      this.lastTapLeft = now;
    } else {
      if (now - this.lastTapRight <= DASH_GAP) {
        this.triggerDash(direction, body);
      }
      this.lastTapRight = now;
    }
  }

  private triggerDash(direction: 1 | -1, body: Phaser.Physics.Arcade.Body) {
    this.facing = direction;
    this.dashTimer = DASH_DURATION;
    body.setVelocity(direction * DASH_SPEED, body.velocity.y);
  }

  takeDamage(amount: number) {
    if (this.invulnTimer > 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.invulnTimer = 0.3;
    this.sprite.setTintFill(0xfff1f2);
    window.setTimeout(() => this.sprite.setTint(this.tint), 120);
  }

  healFull() {
    this.hp = 100;
  }
}
