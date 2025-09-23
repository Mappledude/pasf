import Phaser from "phaser";
import { collection, onSnapshot, type Firestore, type QueryDocumentSnapshot } from "firebase/firestore";
import { upsertMyActor } from "../services/actors";

type Facing = "L" | "R";
type Anim = "idle" | "walk" | "attack";

type Actor = {
  uid: string;
  dn: string;
  x: number;
  y: number;
  facing: Facing;
  anim: Anim;
  seq: number;
  displayName?: string;
};

type RemoteActorVisual = {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  seq: number;
};

export interface ArenaSceneOptions {
  db: Firestore;
  arenaId: string;
  uid: string;
  dn: string;
}

function makePlaceholderTexture(scene: Phaser.Scene, key: string) {
  if (scene.textures.exists(key)) {
    return;
  }
  const graphics = scene.add.graphics({ x: 0, y: 0 });
  graphics.setVisible(false);
  graphics.fillStyle(0xf97316, 1);
  graphics.fillRect(0, 0, 28, 36);
  graphics.generateTexture(key, 28, 36);
  graphics.destroy();
}

const blockedKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "]);
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (event) => {
      if (blockedKeys.has(event.key)) {
        event.preventDefault();
      }
    },
    { passive: false },
  );
}

export class ArenaScene extends Phaser.Scene {
  private opts: ArenaSceneOptions;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
  private me!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private meLabel?: Phaser.GameObjects.Text;
  private others = new Map<string, RemoteActorVisual>();
  private seq = 0;
  private lastSend = 0;
  private unsubscribeActors?: () => void;
  private meLabelText = "";

  constructor(opts: ArenaSceneOptions) {
    super({ key: "arena" });
    this.opts = opts;
  }

  init(data?: Partial<ArenaSceneOptions>) {
    if (data) {
      this.updateOptions(data);
    }
  }

  updateOptions(opts: Partial<ArenaSceneOptions>) {
    this.opts = { ...this.opts, ...opts };
    this.refreshLocalLabel();
  }

  preload() {
    makePlaceholderTexture(this, "stick");
  }

  create() {
    this.physics.world.setBounds(0, 0, 2000, 1200);

    this.me = this.physics.add
      .sprite(400, 300, "stick")
      .setCollideWorldBounds(true)
      .setOrigin(0.5, 0.5);
    this.me.setDataEnabled();
    this.me.setData("facing", "R");

    const body = this.me.body as Phaser.Physics.Arcade.Body;
    body.setDrag(900, 900);
    body.setMaxSpeed(240);
    body.setAllowRotation(false);

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("keyboard-unavailable");
    }
    this.cursors = keyboard.createCursorKeys();
    this.wasd = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.subscribeActors();

    this.meLabel = this.add
      .text(this.me.x, this.me.y - 32, this.getLocalDisplayName(), {
        fontSize: "12px",
        color: "#f8fafc",
        fontFamily: '"JetBrains Mono", monospace',
      })
      .setOrigin(0.5, 1);
    this.meLabelText = this.getLocalDisplayName();

    void this.publishMyActor({
      x: this.me.x,
      y: this.me.y,
      facing: "R",
      anim: "idle",
      seq: ++this.seq,
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.handleShutdown, this);
  }

  update(time: number) {
    if (!this.me?.body) return;

    const speed = 260;
    const left = this.cursors.left?.isDown || this.wasd.left.isDown;
    const right = this.cursors.right?.isDown || this.wasd.right.isDown;
    const up = this.cursors.up?.isDown || this.wasd.up.isDown;
    const down = this.cursors.down?.isDown || this.wasd.down.isDown;

    let vx = 0;
    let vy = 0;
    if (left) vx -= speed;
    if (right) vx += speed;
    if (up) vy -= speed;
    if (down) vy += speed;

    this.me.setVelocity(vx, vy);

    const moving = Math.abs(vx) + Math.abs(vy) > 0;
    const previousFacing = (this.me.getData("facing") as Facing | undefined) ?? "R";
    const facing: Facing = vx < 0 ? "L" : vx > 0 ? "R" : previousFacing;
    this.me.setData("facing", facing);
    this.me.setFlipX(facing === "L");

    this.updateLocalLabelPosition();
    this.refreshLocalLabel();

    if (time - this.lastSend > 66) {
      this.lastSend = time;
      void this.publishMyActor({
        x: this.me.x,
        y: this.me.y,
        facing,
        anim: moving ? "walk" : "idle",
        seq: ++this.seq,
      }).catch((error) => {
        console.warn("[ARENA] actor-publish-failed", error);
      });
    }
  }

  private subscribeActors() {
    const { db, arenaId, uid } = this.opts;
    const ref = collection(db, "arenas", arenaId, "actors");

    this.unsubscribeActors?.();
    this.unsubscribeActors = onSnapshot(ref, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const docSnap = change.doc as QueryDocumentSnapshot<Partial<Actor>>;
        const data = docSnap.data() ?? {};
        const actorUid = (data.uid as string | undefined) ?? docSnap.id;
        if (!actorUid || actorUid === uid) {
          return;
        }

        if (change.type === "removed") {
          const visual = this.others.get(actorUid);
          visual?.container.destroy(true);
          this.others.delete(actorUid);
          return;
        }

        const seq = typeof data.seq === "number" ? data.seq : 0;
        const x = typeof data.x === "number" ? data.x : 0;
        const y = typeof data.y === "number" ? data.y : 0;
        const facing = (data.facing as Facing | undefined) ?? "R";
        const label = this.resolveDisplayName(data);

        let visual = this.others.get(actorUid);
        if (!visual) {
          const container = this.add.container(x, y);
          const sprite = this.add.sprite(0, 0, "stick");
          sprite.setOrigin(0.5, 0.5);
          const nameLabel = this.add
            .text(0, -32, label, {
              fontSize: "12px",
              color: "#f8fafc",
              fontFamily: '"JetBrains Mono", monospace',
            })
            .setOrigin(0.5, 1);
          container.add([sprite, nameLabel]);
          visual = { container, sprite, label: nameLabel, seq: Number.NEGATIVE_INFINITY };
          this.others.set(actorUid, visual);
        }

        if (seq <= visual.seq) {
          return;
        }
        visual.seq = seq;

        visual.label.setText(label);
        visual.sprite.setFlipX(facing === "L");

        this.tweens.add({
          targets: visual.container,
          x,
          y,
          duration: 80,
          ease: "Linear",
        });
      });
    });
  }

  private handleShutdown() {
    this.unsubscribeActors?.();
    this.unsubscribeActors = undefined;
    this.others.forEach((visual) => visual.container.destroy(true));
    this.others.clear();
    this.meLabel?.destroy();
    this.meLabel = undefined;
  }

  private async publishMyActor(patch: Pick<Actor, "x" | "y" | "facing" | "anim" | "seq">) {
    const { db, arenaId, uid } = this.opts;
    await upsertMyActor(db, arenaId, uid, patch);
  }

  private getLocalDisplayName(): string {
    const hint = typeof this.opts.dn === "string" ? this.opts.dn.trim() : "";
    if (hint.length > 0) return hint;
    const suffix = this.opts.uid.slice(-4) || "0000";
    return `Player ${suffix}`;
  }

  private refreshLocalLabel() {
    if (!this.meLabel) return;
    const next = this.getLocalDisplayName();
    if (next !== this.meLabelText) {
      this.meLabel.setText(next);
      this.meLabelText = next;
    }
  }

  private updateLocalLabelPosition() {
    if (!this.meLabel) return;
    this.meLabel.setPosition(this.me.x, this.me.y - 32);
  }

  private resolveDisplayName(data: Partial<Actor>): string {
    const dn = typeof data.dn === "string" ? data.dn.trim() : "";
    if (dn.length > 0) return dn;
    const legacy = typeof data.displayName === "string" ? data.displayName.trim() : "";
    if (legacy.length > 0) return legacy;
    const uid = typeof data.uid === "string" ? data.uid : "";
    const suffix = uid.slice(-4) || "0000";
    return `Player ${suffix}`;
  }
}

export default ArenaScene;
