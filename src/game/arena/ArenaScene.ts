import Phaser from "phaser";
import {
  createArenaSync,
  type ArenaLastEvent,
  type ArenaPhase,
  type ArenaPlayerFrame,
  type ArenaStateSnapshot,
  type ArenaSync,
} from "../net/arenaSync";
import { Player } from "../entities/Player";
import { RemoteOpponent } from "../entities/RemoteOpponent";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const GROUND_HEIGHT = 40;
export interface ArenaSceneConfig {
  arenaId: string;
  me: { id: string; codename: string };
  spawn: { x: number; y: number };
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

  private sync?: ArenaSync;
  private unsubscribe?: () => void;
  private opponentId?: string;
  private controlsLocked = false;
  private latestOpponentName = "";
  private currentPhase: ArenaPhase = "lobby";
  private lastKoTick?: number;
  private meFrame?: ArenaPlayerFrame;
  private opponentFrame?: ArenaPlayerFrame;

  constructor() {
    super("Arena");
  }

  init(data: ArenaSceneConfig) {
    this.arenaId = data.arenaId;
    this.me = data.me;
    this.spawn = data.spawn;
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
    if (!this.player) return;
    if (!this.player.isAttackActive()) return;
    this.player.registerHit();
  };

  private handleArenaState = (state?: ArenaStateSnapshot) => {
    this.applyPhaseUpdate(state?.phase, state?.lastEvent);

    const players = state?.players ?? {};
    const meState = players?.[this.me.id];
    this.meFrame = meState ?? undefined;

    if (meState && this.player) {
      if (typeof meState.hp === "number") {
        this.player.setHp(meState.hp);
      }
      if (meState.pos && this.currentPhase !== "play") {
        this.player.setPosition(meState.pos.x, meState.pos.y);
      }
    }

    const otherIds = Object.keys(players ?? {}).filter((id) => id !== this.me.id);
    otherIds.sort();
    const targetOpponentId = otherIds[0];

    if (!targetOpponentId) {
      this.opponentId = undefined;
      this.opponentFrame = undefined;
      this.opponent?.setActive(false);
      this.latestOpponentName = "";
      this.updateHud();
      return;
    }

    this.opponentId = targetOpponentId;
    const opponentState = players?.[targetOpponentId];
    if (!opponentState) {
      this.opponentFrame = undefined;
      this.updateHud();
      return;
    }

    this.opponentFrame = opponentState;
    const codename = opponentState.codename ?? this.latestOpponentName || "Agent";
    this.latestOpponentName = codename;
    this.opponent?.setCodename(codename);

    const pos = opponentState.pos ?? this.spawn;
    this.opponent?.setState({
      x: pos.x,
      y: pos.y,
      facing: opponentState.dir === -1 ? "L" : "R",
      hp: typeof opponentState.hp === "number" ? opponentState.hp : undefined,
    });

    this.updateHud();
  };

  private applyPhaseUpdate(phase?: ArenaPhase, lastEvent?: ArenaLastEvent) {
    if (phase && phase !== this.currentPhase) {
      this.currentPhase = phase;
      const shouldLock = phase !== "play";
      if (this.player) {
        this.player.setControlsEnabled(!shouldLock);
      }
      this.controlsLocked = shouldLock;
    }

    if (lastEvent?.type === "ko" && lastEvent.tick !== this.lastKoTick) {
      this.flashKo();
      this.lastKoTick = lastEvent.tick;
    }
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
    const myHpSource =
      typeof this.meFrame?.hp === "number"
        ? this.meFrame.hp
        : this.player
        ? this.player.hp
        : 0;
    const myStocks = this.meFrame?.stocks;
    let myText = `You (${this.me.codename}) HP: ${Math.round(myHpSource)}`;
    if (typeof myStocks === "number") {
      myText += ` · Stocks: ${myStocks}`;
    }
    this.hudText.setText(myText);

    if (!this.oppHudText) {
      return;
    }

    if (!this.opponentId || !this.opponentFrame) {
      this.oppHudText.setText("Waiting for opponent...");
      return;
    }

    const oppHpSource =
      typeof this.opponentFrame.hp === "number"
        ? this.opponentFrame.hp
        : this.opponent
        ? this.opponent.hp
        : 0;
    const oppStocks = this.opponentFrame.stocks;
    const name = this.latestOpponentName || this.opponentFrame.codename || "Opponent";
    let oppText = `${name} HP: ${Math.round(oppHpSource)}`;
    if (typeof oppStocks === "number") {
      oppText += ` · Stocks: ${oppStocks}`;
    }
    this.oppHudText.setText(oppText);
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
  }
}
