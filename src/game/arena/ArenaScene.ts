import Phaser from "phaser";
import { Player } from "../entities/Player";
import { RemoteOpponent } from "../entities/RemoteOpponent";

// Host-authoritative networking (no peer state writes)
import {
  createMatchChannel,
  type MatchChannel,
  type AuthoritativeSnapshot,
} from "../net/matchChannel";
import { SnapshotBuffer } from "../net/snapshotBuffer";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const GROUND_HEIGHT = 40;

export interface ArenaSceneConfig {
  arenaId: string;
  me: { id: string; codename: string };
  spawn: { x: number; y: number };
  /**
   * Optional hint from the caller: if true, this client is expected to be the host.
   * (Rendering remains snapshot-driven; host authority is handled inside matchChannel.)
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

  private textureAddHandler?: (key: string, texture: Phaser.Textures.Texture) => void;

  // Net & interpolation
  private channel?: MatchChannel;
  private snapbuf = new SnapshotBuffer<AuthoritativeSnapshot>(4);
  private latestOpponentName = "";
  private opponentId?: string;

  // role/seat (optional UI later)
  private isHost = false;
  private seat?: "A" | "B";

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

    // Local player and remote opponent visuals
    this.player = new Player(this, this.spawn.x, this.spawn.y);
    this.player.healFull();

    this.opponent = new RemoteOpponent(this, this.spawn.x, this.spawn.y);

    if (this.ground && this.player) {
      this.physics.add.collider(this.player.sprite, this.ground);
    }

    this.createHud();
    this.createKoText();

    // Promote rigs when textures are added (e.g., when atlases load later)
    this.tryPromoteFighterRigs();
    this.textureAddHandler = () => {
      this.tryPromoteFighterRigs();
      this.player?.handleTextureUpdate();
      this.opponent?.handleTextureUpdate();
    };
    this.textures.on(Phaser.Textures.Events.ADD, this.textureAddHandler, this);

    // Networking channel (handles inputs + snapshot subscription internally)
    this.channel = createMatchChannel({ arenaId: this.arenaId });

    // Role/seat (if the channel exposes these)
    this.channel.onRoleChange?.((role) => {
      this.isHost = role === "host";
    });
    this.channel.onSeatChange?.((seat) => {
      this.seat = seat;
    });

    // Authoritative snapshot stream → push into interpolation buffer
    this.channel.onSnapshot((snap) => {
      this.snapbuf.push(snap, this.time.now);
      // KO flash when my hp crosses >0 → <=0 (visual only; respawn is authoritative)
      const meNode = snap.players?.[this.me.id];
      if (meNode && this.player && this.player.hp > 0 && (meNode.hp ?? 100) <= 0) {
        this.flashKo();
      }
    });

    // Clean teardown
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.handleShutdown, this);
  }

  update(_: number, delta: number) {
    const dt = delta / 1000;
    if (!this.player) return;

    // Local simulation step for inputs/animations (visual)
    this.player.update(dt);

    // Publish inputs to the channel (no state writes from this client)
    const flags = this.player.getInputFlags(); // { left,right,up,attack1,attack2,... }
    this.channel?.publishInputs({ ...flags, codename: this.me.codename });

    // Render from authoritative snapshots (interpolated)
    this.applyInterpolatedState();
  }

  /** Apply interpolated authoritative snapshot to entities (no local prediction). */
  private applyInterpolatedState() {
    const view = this.snapbuf.getInterpolated(this.time.now);
    if (!view) return;

    const players = view.players ?? {};

    // Me (local fighter visuals mirror authoritative state)
    const meState = players[this.me.id];
    if (meState && this.player) {
      const x = meState.x ?? this.spawn.x;
      const y = meState.y ?? this.spawn.y;
      this.player.setPosition(x, y);
      this.player.setFacing(meState.facing === "L" ? "L" : "R");
      if (typeof meState.hp === "number") this.player.setHp(meState.hp);
      if (meState.anim) this.player.playAnim(meState.anim);
    }

    // Pick first other player as opponent (temporary until seats UI wires in)
    const otherId = Object.keys(players).find((id) => id !== this.me.id);
    if (!otherId) {
      this.opponentId = undefined;
      this.opponent?.setActive(false);
      this.latestOpponentName = "";
      this.updateHud();
      return;
    }

    const opp = players[otherId]!;
    this.opponentId = otherId;
    this.opponent?.setActive(true);
    this.opponent?.setCodename(opp.codename ?? "Agent");
    this.opponent?.setState({
      x: opp.x ?? this.spawn.x,
      y: opp.y ?? this.spawn.y,
      facing: opp.facing === "L" ? "L" : "R",
      hp: typeof opp.hp === "number" ? opp.hp : (this.opponent?.hp ?? 100),
      anim: opp.anim,
      vx: opp.vx,
      vy: opp.vy,
    });

    if (this.opponent && typeof opp.hp === "number" && this.opponent.hp > 0 && opp.hp <= 0) {
      this.flashKo();
    }

    this.latestOpponentName = opp.codename ?? "Agent";
    this.updateHud();
  }

  private createGround() {
    const groundY = WORLD_HEIGHT - GROUND_HEIGHT / 2;
    this.ground = this.add.rectangle(
      WORLD_WIDTH / 2,
      groundY,
      WORLD_WIDTH,
      GROUND_HEIGHT,
      0x1f2937
    );
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
    const opponentHp =
      this.opponent && this.opponent.sprite.visible ? Math.round(this.opponent.hp) : null;

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
    if (this.textureAddHandler) {
      this.textures.off(Phaser.Textures.Events.ADD, this.textureAddHandler, this);
      this.textureAddHandler = undefined;
    }
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

    this.channel?.destroy?.();
    this.channel = undefined;

    this.snapbuf.clear();
  }

  private tryPromoteFighterRigs() {
    this.player?.refreshRig();
    this.opponent?.refreshRig();
  }
}
