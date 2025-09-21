import Phaser from "phaser";
import { createArenaSync, type ArenaStateSnapshot, type ArenaSync } from "../net/arenaSync";
import { createSnapshotBuffer } from "../net/interpolate";
import { Player } from "../entities/Player";
import { RemoteOpponent } from "../entities/RemoteOpponent";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const GROUND_HEIGHT = 40;
const DAMAGE_PER_HIT = 10;
const DAMAGE_DEBOUNCE_MS = 120;
const RESPAWN_DELAY_MS = 1500;

export interface ArenaSceneConfig {
  arenaId: string;
  me: { id: string; codename: string };
  spawn: { x: number; y: number };
  /**
   * When true, the local client is driving the authoritative simulation and should
   * not interpolate its own avatar.
   */
  isHostClient?: boolean;
}

export default class ArenaScene extends Phaser.Scene {
  private arenaId!: string;
  private me!: { id: string; codename: string };
  private spawn!: { x: number; y: number };

  private player?: Player;
  private opponent?: RemoteOpponent;
  private ground?: Phaser.GameObjects.Rectangle;
  private hudText?: Phaser.GameObjects.Text;
  private oppHudText?: Phaser.GameObjects.Text;
  private koText?: Phaser.GameObjects.Text;
  private koTween?: Phaser.Tweens.Tween;
  private respawnTimer?: Phaser.Time.TimerEvent;

  private sync?: ArenaSync;
  private unsubscribe?: () => void;
  private opponentId?: string;
  private lastHitAt = 0;
  private controlsLocked = false;
  private latestOpponentName = "";
  private isHostClient = false;
  private needsHudUpdate = false;
  private readonly snapshotBuffer = createSnapshotBuffer({ interpolationDelayMs: 120 });

  constructor() {
    super("Arena");
  }

  init(data: ArenaSceneConfig) {
    this.arenaId = data.arenaId;
    this.me = data.me;
    this.spawn = data.spawn;
    this.isHostClient = data.isHostClient ?? false;
    this.snapshotBuffer.clear();
    this.snapshotBuffer.setBypass(this.me.id, this.isHostClient);
    this.opponentId = undefined;
    this.latestOpponentName = "";
    this.needsHudUpdate = false;
  }

  create() {
    this.cameras.main.setBackgroundColor(0x0f1115);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.createGround();

    this.player = new Player(this, this.spawn.x, this.spawn.y);
    this.player.healFull();

    this.opponent = new RemoteOpponent(this, this.spawn.x, this.spawn.y);

    if (this.ground && this.player) {
      this.physics.add.collider(this.player.sprite, this.ground);
    }

    if (this.player && this.opponent) {
      this.physics.add.overlap(
        this.player.attackHitbox,
        this.opponent.sprite,
        this.handleAttackOverlap,
        undefined,
        this,
      );
    }

    this.createHud();
    this.createKoText();

    this.sync = createArenaSync({ arenaId: this.arenaId, meId: this.me.id });
    this.unsubscribe = this.sync.subscribe(this.handleArenaState);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.handleShutdown, this);
  }

  update(_: number, delta: number) {
    const dt = delta / 1000;
    if (!this.player) return;

    this.player.update(dt);

    this.applyOpponentInterpolation();

    const body = this.player.body;
    const facing = this.player.facing === 1 ? "R" : "L";
    this.sync?.updateLocalState({
      codename: this.me.codename,
      x: this.player.sprite.x,
      y: this.player.sprite.y,
      vx: body.velocity.x,
      vy: body.velocity.y,
      facing,
      anim: this.player.isAttackActive() ? "attack" : undefined,
      hp: this.player.hp,
    });
  }

  private handleAttackOverlap = () => {
    if (!this.player || !this.opponentId || !this.opponent) return;
    if (!this.player.isAttackActive()) return;
    if (!this.player.registerHit()) return;

    const now = this.time.now;
    if (now - this.lastHitAt < DAMAGE_DEBOUNCE_MS) {
      return;
    }
    this.lastHitAt = now;

    this.sync?.applyDamage(this.opponentId, DAMAGE_PER_HIT).catch((err) => {
      console.warn("[ArenaScene] failed to apply damage", err);
    });
  };

  private handleArenaState = (state?: ArenaStateSnapshot) => {
    const players = state?.players ?? {};
    const meState = players?.[this.me.id];

    if (meState && this.player) {
      const hp = typeof meState.hp === "number" ? meState.hp : this.player.hp;
      const prevHp = this.player.hp;
      this.player.setHp(hp);
      if (prevHp > 0 && hp <= 0) {
        this.onLocalKo();
      }
      this.updateHud();
    }

    const otherIds = Object.keys(players ?? {}).filter((id) => id !== this.me.id);
    otherIds.sort();
    const targetOpponentId = otherIds[0];

    if (!targetOpponentId) {
      if (this.opponentId) {
        this.snapshotBuffer.clear(this.opponentId);
      }
      this.opponentId = undefined;
      this.opponent?.setActive(false);
      this.latestOpponentName = "";
      this.needsHudUpdate = false;
      this.updateHud();
      return;
    }

    const opponentState = players?.[targetOpponentId];
    if (!opponentState) return;

    if (this.opponentId !== targetOpponentId) {
      if (this.opponentId) {
        this.snapshotBuffer.clear(this.opponentId);
      }
      this.opponentId = targetOpponentId;
      this.opponent?.setCodename(opponentState.codename ?? "Agent");
      this.lastHitAt = 0;
    }

    this.snapshotBuffer.ingest(targetOpponentId, {
      ...opponentState,
      x: typeof opponentState.x === "number" ? opponentState.x : this.spawn.x,
      y: typeof opponentState.y === "number" ? opponentState.y : this.spawn.y,
    });

    this.latestOpponentName = opponentState.codename ?? "Agent";
    this.needsHudUpdate = true;
  };

  private onLocalKo() {
    if (!this.player || this.controlsLocked) return;
    this.controlsLocked = true;
    this.player.setControlsEnabled(false);
    this.flashKo();

    this.respawnTimer?.remove(false);
    this.respawnTimer = this.time.delayedCall(RESPAWN_DELAY_MS, () => {
      if (!this.player) return;
      this.sync?.respawn(this.spawn).catch((err) => console.warn("[ArenaScene] respawn failed", err));
      this.player.setPosition(this.spawn.x, this.spawn.y);
      this.player.setHp(100);
      this.player.setControlsEnabled(true);
      this.controlsLocked = false;
      this.lastHitAt = 0;
      this.updateHud();
    });
  }

  private createGround() {
    const groundY = WORLD_HEIGHT - GROUND_HEIGHT / 2;
    this.ground = this.add.rectangle(WORLD_WIDTH / 2, groundY, WORLD_WIDTH, GROUND_HEIGHT, 0x1f2937);
    this.physics.add.existing(this.ground, true);
    const body = this.ground.body as Phaser.Physics.Arcade.StaticBody;
    body.updateFromGameObject();
  }

  private createHud() {
    this.hudText = this.add.text(20, 16, "", {
      fontFamily: "monospace",
      fontSize: "16px",
      color: "#bfdbfe",
    });
    this.hudText.setScrollFactor(0);

    this.oppHudText = this.add.text(20, 40, "", {
      fontFamily: "monospace",
      fontSize: "16px",
      color: "#fca5a5",
    });
    this.oppHudText.setScrollFactor(0);

    this.updateHud();
  }

  private updateHud() {
    if (!this.hudText) return;
    const myHp = this.player ? Math.round(this.player.hp) : 0;
    const opponentHp = this.opponent && this.opponent.sprite.visible ? Math.round(this.opponent.hp) : null;

    this.hudText.setText(`You (${this.me.codename}) HP: ${myHp}`);
    if (this.oppHudText) {
      if (opponentHp === null) {
        this.oppHudText.setText("Waiting for opponent...");
      } else {
        const name = this.latestOpponentName || "Opponent";
        this.oppHudText.setText(`${name} HP: ${opponentHp}`);
      }
    }
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
    this.respawnTimer?.remove(false);
    this.respawnTimer = undefined;
    this.player?.destroy();
    this.player = undefined;
    this.opponent?.destroy();
    this.opponent = undefined;
    this.hudText?.destroy();
    this.hudText = undefined;
    this.oppHudText?.destroy();
    this.oppHudText = undefined;
    this.ground?.destroy();
    this.ground = undefined;
    this.koText?.destroy();
    this.koText = undefined;
    this.sync?.destroy();
    this.sync = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.snapshotBuffer.clear();
  }

  private applyOpponentInterpolation() {
    if (!this.opponent || !this.opponentId) return;
    const transform = this.snapshotBuffer.interpolate(this.opponentId, this.time.now);
    if (!transform) return;

    const prevHp = this.opponent.hp;
    const hp = typeof transform.hp === "number" ? transform.hp : this.opponent.hp;

    this.opponent.setState({
      x: transform.x,
      y: transform.y,
      facing: transform.facing,
      hp,
    });

    if (prevHp > 0 && typeof hp === "number" && hp <= 0) {
      this.flashKo();
    }

    if (transform.didLerp) {
      const lerpValue = Number.isFinite(transform.lerpFactor)
        ? transform.lerpFactor.toFixed(2)
        : "n/a";
      console.log(
        `[SNAP] ${this.opponentId} lerp=${lerpValue} target=${Math.round(transform.targetTime)} from=${Math.round(transform.from.ts)} to=${Math.round(transform.to.ts)}`,
      );
    }

    if (this.needsHudUpdate) {
      this.needsHudUpdate = false;
      this.updateHud();
    }
  }
}
