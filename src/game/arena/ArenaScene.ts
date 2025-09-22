import Phaser from "phaser";
import { Player } from "../entities/Player";
import { RemoteOpponent } from "../entities/RemoteOpponent";
import {
  createMatchChannel,
  type MatchChannel,
  type AuthoritativeSnapshot,
} from "../net/matchChannel";
import type { ArenaEntityFrame, ArenaPlayerFrame } from "../net/arenaSync";
import { SnapshotBuffer } from "../net/snapshotBuffer";
import { debugLog } from "../../net/debug";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const GROUND_HEIGHT = 40;
const RENDER_INTERPOLATION_DELAY_MS = 120;
const LOCAL_CORRECTION_THRESHOLD = 2;
const LOCAL_SNAP_THRESHOLD = 72;
const LOCAL_CORRECTION_LERP = 0.35;
const PRESENCE_DESPAWN_BUFFER_MS = 20_000;

export interface ArenaSceneConfig {
  arenaId: string;
  me: { id: string; codename: string; authUid?: string };
  spawn: { x: number; y: number };
  /**
   * Optional hint from the caller: if true, this client is expected to be the host.
   * (Rendering remains snapshot-driven; host authority is handled inside matchChannel.)
   */
  isHostClient?: boolean;
}

interface NormalizedEntityState {
  id: string;
  kind: string;
  playerId?: string;
  codename?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  hp?: number;
  facing?: -1 | 1;
  facingLabel?: "L" | "R";
  anim?: string;
  attackActiveUntil?: number;
  canAttackAt?: number;
  grounded?: boolean;
  presenceExpireAtMs?: number;
}

interface RemoteActorState {
  actor: RemoteOpponent;
  hp: number;
  codename?: string;
  presenceExpireAtMs?: number;
  lastSeenAt: number;
}

export default class ArenaScene extends Phaser.Scene {
  private arenaId!: string;
  private me!: { id: string; codename: string };
  private meAuthUid!: string;
  private spawn!: { x: number; y: number };

  private player?: Player;
  private ground?: Phaser.GameObjects.Rectangle;

  private hudText?: Phaser.GameObjects.Text;
  private oppHudText?: Phaser.GameObjects.Text;
  private koText?: Phaser.GameObjects.Text;
  private koTween?: Phaser.Tweens.Tween;

  private textureAddHandler?: (key: string, texture: Phaser.Textures.Texture) => void;

  // Net & interpolation
  private channel?: MatchChannel;
  private snapbuf = new SnapshotBuffer<AuthoritativeSnapshot>(6);
  private remoteActors = new Map<string, RemoteActorState>();

  // role/seat (optional UI later)
  private isHost = false;
  private seat?: "A" | "B";
  private localAttackSeq = 0;

  constructor() {
    super("Arena");
  }

  init(data: ArenaSceneConfig) {
    this.arenaId = data.arenaId;
    this.me = data.me;
    this.meAuthUid = data.me.authUid ?? data.me.id;
    this.spawn = data.spawn;
    this.localAttackSeq = 0;
  }

  create() {
    this.cameras.main.setBackgroundColor(0x0f1115);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.createGround();

    // Local player visuals + physics
    this.player = new Player(this, this.spawn.x, this.spawn.y);
    this.player.healFull();
    this.player.on("player:attack", this.handlePlayerAttack, this);

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
      for (const remote of this.remoteActors.values()) {
        remote.actor.handleTextureUpdate();
      }
    };
    this.textures.on(Phaser.Textures.Events.ADD, this.textureAddHandler, this);

    // Networking channel (handles inputs + snapshot subscription internally)
    this.channel = createMatchChannel({ arenaId: this.arenaId, presenceId: this.me.id });

    // Role/seat (if the channel exposes these)
    this.channel.onRoleChange?.((role) => {
      this.isHost = role === "host";
    });
    this.channel.onSeatChange?.((seat) => {
      this.seat = seat;
    });

    // Authoritative snapshot stream → push into interpolation buffer
    this.channel.onSnapshot((snap) => {
      if (!snap) {
        this.snapbuf.clear();
        return;
      }
      this.snapbuf.push(snap, this.time.now);
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
    this.channel?.publishInputs({ ...flags, codename: this.me.codename, attackSeq: this.localAttackSeq });

    // Render from authoritative snapshots (interpolated)
    this.applyInterpolatedState();
  }

  private applyInterpolatedState() {
    const frame = this.snapbuf.getInterpolated(this.time.now, RENDER_INTERPOLATION_DELAY_MS);
    if (!frame) return;

    const previousSnap = frame.previous?.snapshot;
    const nextSnap = frame.next?.snapshot ?? previousSnap;
    if (!nextSnap) return;

    const writerUid =
      nextSnap.lastWriter ??
      nextSnap.writerUid ??
      previousSnap?.lastWriter ??
      previousSnap?.writerUid ??
      null;
    const snapshotTimeMs =
      typeof nextSnap.tMs === "number"
        ? nextSnap.tMs
        : typeof previousSnap?.tMs === "number"
        ? previousSnap.tMs
        : Date.now();

    const ids = new Set<string>();
    this.collectEntityIds(previousSnap, ids);
    this.collectEntityIds(nextSnap, ids);

    if (ids.size === 0) {
      this.collectPlayerIds(previousSnap, ids);
      this.collectPlayerIds(nextSnap, ids);
    }

    const seen = new Set<string>();

    for (const id of ids) {
      const prevNode = this.getEntityData(previousSnap, id);
      const nextNode = this.getEntityData(nextSnap, id);
      const prevState = this.normalizeEntity(id, prevNode);
      const nextState = this.normalizeEntity(id, nextNode);
      const state = this.interpolateEntity(prevState, nextState, frame.alpha);
      if (!state || state.kind !== "fighter") {
        continue;
      }

      if (id !== this.me.id && this.isEntityExpired(state)) {
        this.destroyRemoteActor(id);
        continue;
      }

      if (id === this.me.id) {
        seen.add(id);
        this.updateLocalFighter(state, writerUid, snapshotTimeMs);
      } else {
        this.updateRemoteFighter(id, state, snapshotTimeMs);
        seen.add(id);
      }
    }

    this.cleanupRemoteActors(seen);
    this.updateHud();

    const localCount = seen.has(this.me.id) ? 1 : 0;
    const remoteCount = Math.max(0, seen.size - localCount);
    debugLog(`[RENDER] entities=${seen.size} (local=${localCount}, remote=${remoteCount})`);
  }

  private collectEntityIds(snapshot: AuthoritativeSnapshot | undefined, into: Set<string>) {
    if (!snapshot?.entities) {
      return;
    }
    for (const [id, node] of Object.entries(snapshot.entities)) {
      if (this.shouldRenderEntity(node)) {
        into.add(id);
      }
    }
  }

  private collectPlayerIds(snapshot: AuthoritativeSnapshot | undefined, into: Set<string>) {
    if (!snapshot?.players) {
      return;
    }
    for (const id of Object.keys(snapshot.players)) {
      into.add(id);
    }
  }

  private shouldRenderEntity(node: ArenaEntityFrame | undefined): boolean {
    if (!node) return false;
    const kind = typeof node.kind === "string" ? node.kind : undefined;
    return !kind || kind === "fighter";
  }

  private getEntityData(
    snapshot: AuthoritativeSnapshot | undefined,
    id: string,
  ): ArenaEntityFrame | ArenaPlayerFrame | undefined {
    if (!snapshot) return undefined;
    const entity = snapshot.entities?.[id];
    if (entity && this.shouldRenderEntity(entity)) {
      return entity;
    }
    const player = snapshot.players?.[id];
    if (player) {
      return player;
    }
    return undefined;
  }

  private normalizeEntity(
    id: string,
    node: ArenaEntityFrame | ArenaPlayerFrame | undefined,
  ): NormalizedEntityState | undefined {
    if (!node) {
      return undefined;
    }
    const record = node as Record<string, unknown>;
    const kindValue = typeof record.kind === "string" ? record.kind : "fighter";
    if (kindValue !== "fighter") {
      return { id, kind: kindValue };
    }
    const pos = record.pos as { x?: unknown; y?: unknown } | undefined;
    const vel = record.vel as { x?: unknown; y?: unknown } | undefined;
    const dir = record.dir;
    const facing = record.facing;

    const x = this.pickNumber(record.x, pos?.x);
    const y = this.pickNumber(record.y, pos?.y);
    const vx = this.pickNumber(record.vx, vel?.x);
    const vy = this.pickNumber(record.vy, vel?.y);
    const hp = this.pickNumber(record.hp);

    const facingLabel =
      typeof facing === "string"
        ? facing === "L"
          ? "L"
          : facing === "R"
          ? "R"
          : undefined
        : this.toFacingLabel(typeof dir === "number" ? dir : undefined);
    const numericFacing =
      typeof dir === "number"
        ? dir < 0
          ? -1
          : 1
        : facingLabel === "L"
        ? -1
        : facingLabel === "R"
        ? 1
        : undefined;

    const attackActiveUntil = this.pickNumber(record.attackActiveUntil);
    const presenceExpireAt = this.parseTime(
      record.presenceExpireAt ?? (record.presence as { expireAt?: unknown } | undefined)?.expireAt,
    );

    return {
      id,
      kind: "fighter",
      playerId: typeof record.playerId === "string" ? record.playerId : undefined,
      codename: typeof record.codename === "string" ? record.codename : undefined,
      x,
      y,
      vx,
      vy,
      hp,
      facing: numericFacing,
      facingLabel,
      anim: typeof record.anim === "string" ? record.anim : undefined,
      attackActiveUntil,
      canAttackAt: this.pickNumber(record.canAttackAt),
      grounded: typeof record.grounded === "boolean" ? record.grounded : undefined,
      presenceExpireAtMs: presenceExpireAt,
    };
  }

  private interpolateEntity(
    prev: NormalizedEntityState | undefined,
    next: NormalizedEntityState | undefined,
    alpha: number,
  ): NormalizedEntityState | undefined {
    if (!prev && !next) {
      return undefined;
    }
    if (!prev) {
      return next;
    }
    if (!next) {
      return prev;
    }

    return {
      id: next.id ?? prev.id,
      kind: next.kind ?? prev.kind,
      playerId: next.playerId ?? prev.playerId,
      codename: next.codename ?? prev.codename,
      x: this.lerpNumber(prev.x, next.x, alpha),
      y: this.lerpNumber(prev.y, next.y, alpha),
      vx: this.lerpNumber(prev.vx, next.vx, alpha),
      vy: this.lerpNumber(prev.vy, next.vy, alpha),
      hp: typeof next.hp === "number" ? next.hp : prev.hp,
      facing: typeof next.facing === "number" ? next.facing : prev.facing,
      facingLabel: next.facingLabel ?? prev.facingLabel ?? this.toFacingLabel(next.facing ?? prev.facing),
      anim: next.anim ?? prev.anim,
      attackActiveUntil:
        typeof next.attackActiveUntil === "number" ? next.attackActiveUntil : prev.attackActiveUntil,
      canAttackAt: typeof next.canAttackAt === "number" ? next.canAttackAt : prev.canAttackAt,
      grounded: typeof next.grounded === "boolean" ? next.grounded : prev.grounded,
      presenceExpireAtMs:
        typeof next.presenceExpireAtMs === "number" ? next.presenceExpireAtMs : prev.presenceExpireAtMs,
    };
  }

  private updateLocalFighter(state: NormalizedEntityState, writerUid: string | null, timeMs: number) {
    const player = this.player;
    if (!player) return;

    const prevHp = player.hp;
    if (typeof state.hp === "number") {
      player.setHp(state.hp);
      if (prevHp > 0 && state.hp <= 0) {
        this.flashKo();
      }
    }

    const facing = state.facingLabel ?? this.toFacingLabel(state.facing);
    if (facing) {
      player.setFacing(facing);
    }

    const anim = this.resolveAnim(state, timeMs);
    if (anim === "attack") {
      player.playAnim("attack");
    } else if (!player.isAttackActive()) {
      player.playAnim("idle");
    }

    if (typeof state.x === "number" && typeof state.y === "number") {
      if (!writerUid || writerUid === this.meAuthUid) {
        player.setPosition(state.x, state.y);
        if (typeof state.vx === "number" || typeof state.vy === "number") {
          const vx = typeof state.vx === "number" ? state.vx : player.body.velocity.x;
          const vy = typeof state.vy === "number" ? state.vy : player.body.velocity.y;
          player.body.setVelocity(vx, vy);
        }
      } else {
        const currentX = player.sprite.x;
        const currentY = player.sprite.y;
        const distance = Phaser.Math.Distance.Between(currentX, currentY, state.x, state.y);
        if (distance > LOCAL_CORRECTION_THRESHOLD) {
          const ratio = distance > LOCAL_SNAP_THRESHOLD ? 1 : LOCAL_CORRECTION_LERP;
          player.correctState({ x: state.x, y: state.y, vx: state.vx, vy: state.vy }, ratio);
        }
      }
    }
  }

  private updateRemoteFighter(id: string, state: NormalizedEntityState, timeMs: number) {
    const meta = this.ensureRemoteActor(id);
    const actor = meta.actor;

    if (state.codename) {
      meta.codename = state.codename;
      actor.setCodename(state.codename);
    }

    const anim = this.resolveAnim(state, timeMs);
    actor.setActive(true);
    actor.setState({
      x: typeof state.x === "number" ? state.x : actor.sprite.x,
      y: typeof state.y === "number" ? state.y : actor.sprite.y,
      facing: state.facingLabel ?? this.toFacingLabel(state.facing) ?? "R",
      hp: typeof state.hp === "number" ? state.hp : undefined,
      anim,
      vx: state.vx,
      vy: state.vy,
    });

    if (typeof state.hp === "number") {
      const prevHp = meta.hp;
      meta.hp = state.hp;
      if (prevHp > 0 && state.hp <= 0) {
        this.flashKo();
      }
    }

    meta.presenceExpireAtMs = typeof state.presenceExpireAtMs === "number" ? state.presenceExpireAtMs : undefined;
    meta.lastSeenAt = this.time.now;
  }

  private resolveAnim(state: NormalizedEntityState, timeMs: number): string | undefined {
    if (state.anim) {
      return state.anim;
    }
    if (typeof state.attackActiveUntil === "number" && timeMs < state.attackActiveUntil) {
      return "attack";
    }
    return undefined;
  }

  private cleanupRemoteActors(seen: Set<string>) {
    for (const id of [...this.remoteActors.keys()]) {
      if (!seen.has(id)) {
        this.destroyRemoteActor(id);
      }
    }
  }

  private destroyRemoteActor(id: string) {
    const meta = this.remoteActors.get(id);
    if (!meta) return;
    meta.actor.destroy();
    this.remoteActors.delete(id);
  }

  private handlePlayerAttack() {
    this.localAttackSeq += 1;
    this.channel?.publishInputs({ attackSeq: this.localAttackSeq });
  }

  private ensureRemoteActor(id: string): RemoteActorState {
    let meta = this.remoteActors.get(id);
    if (!meta) {
      const actor = new RemoteOpponent(this, this.spawn.x, this.spawn.y);
      meta = {
        actor,
        hp: actor.hp,
        codename: actor.codename,
        lastSeenAt: this.time.now,
      };
      this.remoteActors.set(id, meta);
    }
    return meta;
  }

  private pickNumber(...values: (unknown | undefined)[]): number | undefined {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
    return undefined;
  }

  private lerpNumber(a: number | undefined, b: number | undefined, alpha: number): number | undefined {
    if (typeof a === "number" && typeof b === "number") {
      return Phaser.Math.Linear(a, b, Phaser.Math.Clamp(alpha, 0, 1));
    }
    if (typeof b === "number") {
      return b;
    }
    if (typeof a === "number") {
      return a;
    }
    return undefined;
  }

  private toFacingLabel(dir: number | undefined): "L" | "R" | undefined {
    if (typeof dir === "number") {
      return dir < 0 ? "L" : "R";
    }
    return undefined;
  }

  private parseTime(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : undefined;
    }
    if (value && typeof value === "object") {
      const record = value as {
        toMillis?: () => number;
        toDate?: () => Date;
        seconds?: number;
        nanoseconds?: number;
      };
      if (typeof record.toMillis === "function") {
        const ms = record.toMillis();
        if (Number.isFinite(ms)) {
          return ms;
        }
      }
      if (typeof record.toDate === "function") {
        const date = record.toDate();
        if (date) {
          const ms = date.getTime();
          if (Number.isFinite(ms)) {
            return ms;
          }
        }
      }
      if (typeof record.seconds === "number") {
        const seconds = record.seconds;
        const nanos = typeof record.nanoseconds === "number" ? record.nanoseconds : 0;
        return seconds * 1000 + nanos / 1_000_000;
      }
    }
    return undefined;
  }

  private isEntityExpired(state: NormalizedEntityState): boolean {
    if (typeof state.presenceExpireAtMs !== "number") {
      return false;
    }
    return Date.now() - state.presenceExpireAtMs > PRESENCE_DESPAWN_BUFFER_MS;
  }

  private createGround() {
    const groundY = WORLD_HEIGHT - GROUND_HEIGHT / 2;
    this.ground = this.add.rectangle(
      WORLD_WIDTH / 2,
      groundY,
      WORLD_WIDTH,
      GROUND_HEIGHT,
      0x1f2937,
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
    this.hudText.setText(`You (${this.me.codename}) HP: ${myHp}`);
    if (!this.oppHudText) {
      return;
    }
    if (this.remoteActors.size === 0) {
      this.oppHudText.setText("Waiting for opponent...");
      return;
    }

    const entries = [...this.remoteActors.entries()];
    entries.sort((a, b) => {
      const bySeen = b[1].lastSeenAt - a[1].lastSeenAt;
      if (bySeen !== 0) return bySeen;
      return a[0].localeCompare(b[0]);
    });
    const [, primary] = entries[0]!;
    const name = primary.codename ?? primary.actor.codename ?? "Opponent";
    const hp = Math.round(primary.actor.hp);
    this.oppHudText.setText(`${name} HP: ${hp}`);
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

    if (this.player) {
      this.player.off("player:attack", this.handlePlayerAttack, this);
      this.player.destroy();
    }
    this.player = undefined;

    for (const remote of this.remoteActors.values()) {
      remote.actor.destroy();
    }
    this.remoteActors.clear();

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
    for (const remote of this.remoteActors.values()) {
      remote.actor.refreshRig();
    }
  }
}
