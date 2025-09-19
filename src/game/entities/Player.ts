import Phaser from "phaser";
import { bindTrainingControls, TrainingControls, unbindTrainingControls } from "../input/keys";

const PLAYER_WIDTH = 28;
const PLAYER_HEIGHT = 48;
const PLAYER_COLOR = 0x38bdf8;
const MOVE_ACCEL = 1200;
const GROUND_DRAG = 1400;
const AIR_DRAG = 200;
const MAX_SPEED = 240;
const JUMP_SPEED = 420;
const COYOTE_TIME = 0.1;
const ATTACK_DURATION = 0.1;
const ATTACK_COOLDOWN = 0.25;
const ATTACK_WIDTH = 32;
const ATTACK_HEIGHT = 20;
const ATTACK_OFFSET = 24;

export class Player extends Phaser.Events.EventEmitter {
  readonly maxHp = 100;
  hp = this.maxHp;
  facing: 1 | -1 = 1;
  readonly sprite: Phaser.GameObjects.Rectangle;
  readonly body: Phaser.Physics.Arcade.Body;
  readonly attackHitbox: Phaser.GameObjects.Rectangle;

  private readonly controls: TrainingControls;
  private attackTimer = 0;
  private attackCooldown = 0;
  private attackConsumed = false;
  private coyoteTimer = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super();

    this.sprite = scene.add.rectangle(x, y, PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_COLOR);
    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setMaxVelocity(MAX_SPEED, 900);
    this.body.setDrag(GROUND_DRAG, 0);
    this.body.setSize(PLAYER_WIDTH, PLAYER_HEIGHT, true);

    this.attackHitbox = scene.add.rectangle(x + ATTACK_OFFSET, y, ATTACK_WIDTH, ATTACK_HEIGHT, 0xf97316, 0.5);
    this.attackHitbox.setVisible(false);
    scene.physics.add.existing(this.attackHitbox);
    const attackBody = this.attackHitbox.body as Phaser.Physics.Arcade.Body;
    attackBody.allowGravity = false;
    attackBody.setImmovable(true);
    attackBody.enable = false;

    this.controls = bindTrainingControls(scene.input.keyboard!);
  }

  update(dt: number) {
    const leftDown = this.controls.left.isDown;
    const rightDown = this.controls.right.isDown;

    if (leftDown && !rightDown) {
      this.facing = -1;
    } else if (rightDown && !leftDown) {
      this.facing = 1;
    }

    const onGround = this.body.blocked.down;
    if (onGround) {
      this.coyoteTimer = COYOTE_TIME;
      this.body.setDrag(GROUND_DRAG, 0);
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
      this.body.setDrag(AIR_DRAG, 0);
    }

    if (leftDown === rightDown) {
      this.body.setAccelerationX(0);
      if (!onGround && Math.abs(this.body.velocity.x) < 10) {
        this.body.setVelocityX(0);
      }
    } else {
      const accel = leftDown ? -MOVE_ACCEL : MOVE_ACCEL;
      this.body.setAccelerationX(accel);
    }

    if (this.controls.jump.some((key) => Phaser.Input.Keyboard.JustDown(key))) {
      if (onGround || this.coyoteTimer > 0) {
        this.body.setVelocityY(-JUMP_SPEED);
        this.coyoteTimer = 0;
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.controls.attack) && this.attackCooldown <= 0) {
      this.startAttack();
    }

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);

    const attackBody = this.attackHitbox.body as Phaser.Physics.Arcade.Body;
    const hitboxX = this.sprite.x + this.facing * ATTACK_OFFSET;
    attackBody.reset(hitboxX, this.sprite.y);
    this.attackHitbox.setPosition(hitboxX, this.sprite.y);

    const active = this.attackTimer > 0;
    attackBody.enable = active;
    this.attackHitbox.setVisible(active);
    if (!active) {
      this.attackConsumed = false;
    }
  }

  isAttackActive() {
    return this.attackTimer > 0;
  }

  registerHit(): boolean {
    if (!this.isAttackActive() || this.attackConsumed) {
      return false;
    }
    this.attackConsumed = true;
    this.emit("player:hit");
    return true;
  }

  healFull() {
    this.hp = this.maxHp;
  }

  destroy() {
    unbindTrainingControls(this.controls);
    this.attackHitbox.destroy();
    this.sprite.destroy();
    this.removeAllListeners();
  }

  private startAttack() {
    this.attackTimer = ATTACK_DURATION;
    this.attackCooldown = ATTACK_COOLDOWN;
    this.attackConsumed = false;
  }
}
