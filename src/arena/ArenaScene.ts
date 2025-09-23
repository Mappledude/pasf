import Phaser from "phaser";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

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
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(0xf97316, 1);
  graphics.fillRect(0, 0, 28, 36);
  graphics.generateTexture(key, 28, 36);
  graphics.destroy();
}

export class ArenaScene extends Phaser.Scene {
  private opts: ArenaSceneOptions;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
  private me!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private others = new Map<string, Phaser.GameObjects.Sprite>();
  private seq = 0;
  private lastSend = 0;
  private unsubscribeActors?: () => void;

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

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.subscribeActors();

    void this.publishMyActor({
      uid: this.opts.uid,
      dn: this.opts.dn,
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

    if (time - this.lastSend > 66) {
      this.lastSend = time;
      void this.publishMyActor({
        uid: this.opts.uid,
        dn: this.opts.dn,
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
          const sprite = this.others.get(actorUid);
          sprite?.destroy();
          this.others.delete(actorUid);
          return;
        }

        const seq = typeof data.seq === "number" ? data.seq : 0;
        const x = typeof data.x === "number" ? data.x : 0;
        const y = typeof data.y === "number" ? data.y : 0;
        const facing = (data.facing as Facing | undefined) ?? "R";

        let sprite = this.others.get(actorUid);
        if (!sprite) {
          sprite = this.add.sprite(x, y, "stick");
          sprite.setOrigin(0.5, 0.5);
          sprite.setDataEnabled();
          this.others.set(actorUid, sprite);
        }

        const prevSeq = (sprite.getData("seq") as number | undefined) ?? 0;
        if (seq <= prevSeq) {
          return;
        }
        sprite.setData("seq", seq);

        this.tweens.add({
          targets: sprite,
          x,
          y,
          duration: 80,
          ease: "Linear",
        });
        sprite.setFlipX(facing === "L");
      });
    });
  }

  private handleShutdown() {
    this.unsubscribeActors?.();
    this.unsubscribeActors = undefined;
    this.others.forEach((sprite) => sprite.destroy());
    this.others.clear();
  }

  private async publishMyActor(actor: Actor) {
    const { db, arenaId, uid, dn } = this.opts;
    const ref = doc(db, "arenas", arenaId, "actors", uid);
    await setDoc(
      ref,
      {
        uid,
        dn,
        x: Math.round(actor.x),
        y: Math.round(actor.y),
        facing: actor.facing,
        anim: actor.anim,
        seq: actor.seq,
        ts: serverTimestamp(),
      },
      { merge: true },
    );
  }
}

export default ArenaScene;
