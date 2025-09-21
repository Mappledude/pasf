import Phaser from "phaser";
import { createFighterRig, type FighterPose } from "../arena/fighterRig";
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

  private readonly scene: Phaser.Scene;
  private readonly controls: TrainingControls;
  private attackTimer = 0;
  private attackCooldown = 0;
  private attackConsumed = false;
  private coyoteTimer = 0;
  private controlsEnabled = true;
  private rigPose: FighterPose = "idle";
  private rigState = { onGround: true, velocityX: 0, isAttacking: false };
  private rig: ReturnType<typeof createFighterRig> | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super();

    this.scene = scene;

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

    this.refreshRig();
  }

  update(dt: number) {
    const attackBody = this.attackHitbox.body as Phaser.Physics.Arcade.Body;
    let onGround = this.body.blocked.down;

    if (!this.controlsEnabled) {
      this.body.setAccelerationX(0);
      this.body.setVelocityX(0);
      this.body.setDrag(GROUND_DRAG, 0);
      this.coyoteTimer = 0;
      this.attackCooldown = 0;
      this.attackTimer = 0;
      this.attackConsumed = false;
      attackBody.enable = false;
      this.attackHitbox.setVisible(false);

      const hitboxX = this.sprite.x + this.facing * ATTACK_OFFSET;
      attackBody.reset(hitboxX, this.sprite.y);
      this.attackHitbox.setPosition(hitboxX, this.sprite.y);
      this.updateRigVisual({ onGround, velocityX: 0, isAttacking: false });
      return;
    }

    const leftDown = this.controls.left.isDown;
    const rightDown = this.controls.right.isDown;

    if (leftDown && !rightDown) {
      this.facing = -1;
    } else if (rightDown && !leftDown) {
      this.facing = 1;
    }

    onGround = this.body.blocked.down;
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

    const hitboxX = this.sprite.x + this.facing * ATTACK_OFFSET;
    attackBody.reset(hitboxX, this.sprite.y);
    this.attackHitbox.setPosition(hitboxX, this.sprite.y);

    const active = this.attackTimer > 0;
    attackBody.enable = active;
    this.attackHitbox.setVisible(active);
    if (!active) {
      this.attackConsumed = false;
    }

    this.updateRigVisual({
      onGround,
      velocityX: this.body.velocity.x,
      isAttacking: active,
    });
  }

  getInputFlags() {
    if (!this.controlsEnabled) {
      return { left: false, right: false, jump: false, attack: false };
    }
    return {
      left: this.controls.left.isDown,
      right: this.controls.right.isDown,
      jump: this.controls.jump.some((key) => key.isDown),
      attack: this.controls.attack.isDown,
    };
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
    this.setHp(this.maxHp);
  }

  destroy() {
    unbindTrainingControls(this.controls);
    this.attackHitbox.destroy();
    this.sprite.destroy();
    this.rig?.destroy();
    this.removeAllListeners();
  }

  setControlsEnabled(enabled: boolean) {
    if (this.controlsEnabled === enabled) return;
    this.controlsEnabled = enabled;
    if (!enabled) {
      this.body.setVelocity(0, this.body.velocity.y);
      this.body.setAcceleration(0, 0);
      this.coyoteTimer = 0;
      this.attackTimer = 0;
      this.attackCooldown = 0;
      this.attackConsumed = false;
      const attackBody = this.attackHitbox.body as Phaser.Physics.Arcade.Body;
      attackBody.enable = false;
      this.attackHitbox.setVisible(false);
    }
    this.updateRigVisual({
      onGround: this.body.blocked.down,
      velocityX: this.body.velocity.x,
      isAttacking: false,
    });
  }

  setHp(hp: number) {
    this.hp = Phaser.Math.Clamp(hp, 0, this.maxHp);
    this.updateRigVisual();
  }

  setPosition(x: number, y: number) {
    this.sprite.setPosition(x, y);
    this.body.reset(x, y);
    const attackBody = this.attackHitbox.body as Phaser.Physics.Arcade.Body;
    const hitboxX = x + this.facing * ATTACK_OFFSET;
    attackBody.reset(hitboxX, y);
    this.attackHitbox.setPosition(hitboxX, y);
    this.updateRigVisual();
  }

  correctState(target: { x: number; y: number; vx?: number; vy?: number }, ratio: number) {
    const t = Phaser.Math.Clamp(ratio, 0, 1);
    const x = Phaser.Math.Linear(this.sprite.x, target.x, t);
    const y = Phaser.Math.Linear(this.sprite.y, target.y, t);
    const vx =
      typeof target.vx === "number"
        ? Phaser.Math.Linear(this.body.velocity.x, target.vx, t)
        : this.body.velocity.x;
    const vy =
      typeof target.vy === "number"
        ? Phaser.Math.Linear(this.body.velocity.y, target.vy, t)
        : this.body.velocity.y;
    this.setPosition(x, y);
    this.body.setVelocity(vx, vy);
  }

  setFacing(direction: "L" | "R") {
    const next = direction === "L" ? -1 : 1;
    if (this.facing === next) {
      return;
    }
    this.facing = next;
    const attackBody = this.attackHitbox.body as Phaser.Physics.Arcade.Body;
    const hitboxX = this.sprite.x + this.facing * ATTACK_OFFSET;
    attackBody.reset(hitboxX, this.sprite.y);
    this.attackHitbox.setPosition(hitboxX, this.sprite.y);
    this.updateRigVisual();
  }

  playAnim(anim: string) {
    this.updateRigVisual({ isAttacking: anim === "attack" });
  }

  private startAttack() {
    this.attackTimer = ATTACK_DURATION;
    this.attackCooldown = ATTACK_COOLDOWN;
    this.attackConsumed = false;
    this.emit("player:attack", { facing: this.facing });
  }

  refreshRig() {
    if (this.rig) {
      this.updateRigVisual({
        onGround: this.body.blocked.down,
        velocityX: this.body.velocity.x,
        isAttacking: this.isAttackActive(),
      });
      return true;
    }
    const rig = createFighterRig(this.scene, { tint: PLAYER_COLOR, depth: this.sprite.depth + 1 });
    if (!rig) {
      return false;
    }
    this.rig = rig;
    this.sprite.setVisible(false);
    this.updateRigVisual({
      onGround: this.body.blocked.down,
      velocityX: this.body.velocity.x,
      isAttacking: this.isAttackActive(),
    });
    return true;
  }

  hasRig() {
    return !!this.rig;
  }

  handleTextureUpdate() {
    this.refreshRig();
  }

  private updateRigVisual(
    overrides?: Partial<typeof this.rigState>,
  ) {
    if (!this.rig) {
      return;
    }
    if (overrides) {
      this.rigState = { ...this.rigState, ...overrides };
    }
    this.rig.setPosition(this.sprite.x, this.sprite.y);
    this.rig.setFacing(this.facing);
    const pose = this.resolveRigPose();
    if (pose !== this.rigPose) {
      this.rigPose = pose;
    }
    this.rig.setPose(this.rigPose);
    this.rig.setVisible(true);
  }

  private resolveRigPose(): FighterPose {
    if (this.hp <= 0) {
      return "ko";
    }
    if (this.rigState.isAttacking) {
      return "punch";
    }
    if (!this.rigState.onGround) {
      return "jump";
    }
    if (Math.abs(this.rigState.velocityX) > 40) {
      return "run";
    }
    return "idle";
  }
}
