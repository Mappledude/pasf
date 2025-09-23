// @ts-nocheck
import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

(globalThis as any).__ARENA_TEST_ENV__ = {
  DEV: true,
  VITE_USE_FIREBASE_EMULATORS: "true",
};

if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (cb) => {
    const id = setTimeout(() => cb(performance.now()), 16);
    return id;
  };
}

if (typeof globalThis.cancelAnimationFrame !== "function") {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

class InMemoryAuth extends EventEmitter {
  constructor() {
    super();
    this.currentUser = null;
    this.counter = 0;
    this.emulatorHost = null;
  }

  _emit(user) {
    queueMicrotask(() => this.emit("change", user));
  }

  async signInAnonymously() {
    const user = { uid: `anon-${++this.counter}` };
    this.currentUser = user;
    this._emit(user);
    return { user };
  }

  async signOut() {
    this.currentUser = null;
    this._emit(null);
  }

  onAuthStateChanged(callback, _errorCb) {
    const handler = (user) => callback(user);
    this.on("change", handler);
    queueMicrotask(() => callback(this.currentUser));
    return () => {
      this.off("change", handler);
    };
  }
}

const authEmulator = new InMemoryAuth();

const SERVER_TIMESTAMP_TOKEN = Symbol("serverTimestamp");
const INCREMENT_TOKEN = Symbol("increment");

class Timestamp {
  constructor(millis) {
    this._millis = millis;
  }
  toMillis() {
    return this._millis;
  }
  toDate() {
    return new Date(this._millis);
  }
  static fromMillis(millis) {
    return new Timestamp(millis);
  }
}

const serverTimestamp = () => ({ __op: SERVER_TIMESTAMP_TOKEN });
const increment = (delta) => ({ __op: INCREMENT_TOKEN, value: delta });

const cloneDeep = (value) => {
  if (value === undefined || value === null) return value;
  if (value instanceof Timestamp) return Timestamp.fromMillis(value.toMillis());
  if (Array.isArray(value)) return value.map(cloneDeep);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = cloneDeep(v);
    }
    return out;
  }
  return value;
};

const parentPath = (path) => {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
};

class DocumentSnapshot {
  constructor(path, data) {
    this.ref = { __type: "doc", path, id: path.split("/").pop() };
    this._data = data ? cloneDeep(data) : undefined;
    this.id = this.ref.id;
  }
  exists() {
    return this._data !== undefined;
  }
  data() {
    return this._data ? cloneDeep(this._data) : undefined;
  }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
  }
  forEach(cb) {
    for (const doc of this.docs) cb(doc);
  }
}

class InMemoryFirestore {
  constructor() {
    this.docs = new Map();
    this.docWatchers = new Map();
    this.collectionWatchers = new Map();
  }

  reset() {
    this.docs.clear();
    this.docWatchers.clear();
    this.collectionWatchers.clear();
  }

  _notifyDoc(path) {
    const watchers = this.docWatchers.get(path);
    if (!watchers) return;
    const snap = new DocumentSnapshot(path, this.docs.get(path));
    for (const cb of [...watchers]) {
      queueMicrotask(() => cb(snap));
    }
  }

  _notifyCollection(collectionPath) {
    const watchers = this.collectionWatchers.get(collectionPath);
    if (!watchers) return;
    const snaps = this._collectDocs(collectionPath).map((d) => new DocumentSnapshot(d.path, d.data));
    const snapshot = new QuerySnapshot(snaps);
    for (const cb of [...watchers]) {
      queueMicrotask(() => cb(snapshot));
    }
  }

  _collectDocs(collectionPath) {
    const prefix = collectionPath ? `${collectionPath}/` : "";
    const depth = collectionPath ? collectionPath.split("/").length + 1 : 1;
    const rows = [];
    for (const [path, data] of this.docs.entries()) {
      if (!path.startsWith(prefix)) continue;
      const parts = path.split("/");
      if (parts.length !== depth) continue;
      rows.push({ path, data });
    }
    rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return rows;
  }

  _resolveValue(previous, value) {
    if (value && typeof value === "object") {
      if (value.__op === SERVER_TIMESTAMP_TOKEN) {
        return Timestamp.fromMillis(Date.now());
      }
      if (value.__op === INCREMENT_TOKEN) {
        const base = typeof previous === "number" ? previous : 0;
        return base + value.value;
      }
    }
    if (Array.isArray(value)) {
      return value.map((item, idx) =>
        this._resolveValue(Array.isArray(previous) ? previous[idx] : undefined, item)
      );
    }
    if (value && typeof value === "object" && !(value instanceof Timestamp)) {
      const existing = previous && typeof previous === "object" ? previous : undefined;
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const prevChild = existing ? existing[k] : undefined;
        out[k] = this._resolveValue(prevChild, v);
      }
      return out;
    }
    return value instanceof Timestamp ? Timestamp.fromMillis(value.toMillis()) : value;
  }

  _mergeData(path, data, merge) {
    const existing = merge ? cloneDeep(this.docs.get(path)) ?? {} : {};
    const result = cloneDeep(existing);
    for (const [k, v] of Object.entries(data)) {
      const prev = existing ? existing[k] : undefined;
      result[k] = this._resolveValue(prev, v);
    }
    return result;
  }

  setDoc(path, data, { merge } = { merge: false }) {
    const next = this._mergeData(path, data, merge);
    this.docs.set(path, next);
    this._notifyDoc(path);
    this._notifyCollection(parentPath(path));
  }

  updateDoc(path, data) {
    if (!this.docs.has(path)) {
      const err = new Error("not-found");
      err.code = "not-found";
      throw err;
    }
    this.setDoc(path, data, { merge: true });
  }

  deleteDoc(path) {
    this.docs.delete(path);
    this._notifyDoc(path);
    this._notifyCollection(parentPath(path));
  }

  getDoc(path) {
    const data = this.docs.get(path);
    return new DocumentSnapshot(path, data);
  }

  getDocs(collectionPath) {
    const snaps = this._collectDocs(collectionPath).map((d) => new DocumentSnapshot(d.path, d.data));
    return new QuerySnapshot(snaps);
  }

  onDocSnapshot(path, cb) {
    if (!this.docWatchers.has(path)) {
      this.docWatchers.set(path, new Set());
    }
    const set = this.docWatchers.get(path);
    set.add(cb);
    queueMicrotask(() => cb(new DocumentSnapshot(path, this.docs.get(path))));
    return () => {
      set.delete(cb);
      if (set.size === 0) this.docWatchers.delete(path);
    };
  }

  onCollectionSnapshot(path, cb) {
    if (!this.collectionWatchers.has(path)) {
      this.collectionWatchers.set(path, new Set());
    }
    const set = this.collectionWatchers.get(path);
    set.add(cb);
    queueMicrotask(() => {
      const snaps = this._collectDocs(path).map((d) => new DocumentSnapshot(d.path, d.data));
      cb(new QuerySnapshot(snaps));
    });
    return () => {
      set.delete(cb);
      if (set.size === 0) this.collectionWatchers.delete(path);
    };
  }
}

const firestoreEmulator = new InMemoryFirestore();

const appModule = (() => {
  const apps = new Map();
  return {
    initializeApp(config) {
      const app = { options: config };
      apps.set("default", app);
      return app;
    },
    getApp() {
      return apps.get("default");
    },
  };
})();

const appCheckModule = {
  initializeAppCheck: () => ({}),
};

const authModule = {
  getAuth: () => authEmulator,
  signInAnonymously: () => authEmulator.signInAnonymously(),
  onAuthStateChanged: (_auth, next, error) => authEmulator.onAuthStateChanged(next, error),
  connectAuthEmulator: () => {},
  signOut: () => authEmulator.signOut(),
};

const ensureSecurity = (path, data) => {
  const segments = path.split("/");
  if (segments.length >= 4 && segments[0] === "arenas" && segments[2] === "inputs") {
    const uid = authEmulator.currentUser?.uid;
    if (!uid || data?.authUid !== uid) {
      const err = new Error("permission-denied");
      err.code = "permission-denied";
      throw err;
    }
  }
};

const firestoreModule = {
  getFirestore: () => firestoreEmulator,
  connectFirestoreEmulator: () => {},
  doc: (_db, ...segments) => ({ __type: "doc", path: segments.join("/"), id: segments[segments.length - 1] }),
  collection: (_db, ...segments) => ({ __type: "collection", path: segments.join("/") }),
  setDoc: (ref, data, options) => {
    ensureSecurity(ref.path, data);
    firestoreEmulator.setDoc(ref.path, data, options);
  },
  updateDoc: (ref, data) => {
    ensureSecurity(ref.path, data);
    firestoreEmulator.updateDoc(ref.path, data);
  },
  deleteDoc: (ref) => firestoreEmulator.deleteDoc(ref.path),
  getDoc: (ref) => firestoreEmulator.getDoc(ref.path),
  getDocs: (refOrQuery) => {
    const path = refOrQuery.__type === "query" ? refOrQuery.collection.path : refOrQuery.path;
    return firestoreEmulator.getDocs(path);
  },
  onSnapshot: (refOrQuery, cb) => {
    if (refOrQuery.__type === "doc") {
      return firestoreEmulator.onDocSnapshot(refOrQuery.path, cb);
    }
    const path = refOrQuery.__type === "collection" ? refOrQuery.path : refOrQuery.collection.path;
    return firestoreEmulator.onCollectionSnapshot(path, cb);
  },
  serverTimestamp,
  Timestamp,
  increment,
  query: (collectionRef, ...clauses) => ({ __type: "query", collection: collectionRef, clauses }),
  orderBy: (field, direction = "asc") => ({ field, direction }),
  runTransaction: async (_db, updateFn) => {
    const mutations = [];
    const tx = {
      async get(ref) {
        return firestoreEmulator.getDoc(ref.path);
      },
      set(ref, data, options) {
        mutations.push({ kind: "set", ref, data, options });
      },
      update(ref, data) {
        mutations.push({ kind: "update", ref, data });
      },
      delete(ref) {
        mutations.push({ kind: "delete", ref });
      },
    };
    const result = await updateFn(tx);
    for (const mutation of mutations) {
      if (mutation.kind === "set") firestoreEmulator.setDoc(mutation.ref.path, mutation.data, mutation.options);
      else if (mutation.kind === "update") firestoreEmulator.updateDoc(mutation.ref.path, mutation.data);
      else if (mutation.kind === "delete") firestoreEmulator.deleteDoc(mutation.ref.path);
    }
    return result;
  },
};

const functionsModule = {
  getFunctions: () => ({}),
};

globalThis.__ARENA_EMULATOR__ = {
  app: appModule,
  appCheck: appCheckModule,
  auth: authModule,
  firestore: { ...firestoreModule, Timestamp },
  functions: functionsModule,
};


let firebaseModulePromise = null;
let hostLoopPromise = null;

const importFirebase = async () => {
  if (!firebaseModulePromise) {
    firebaseModulePromise = import("../src/firebase.js").then(async (mod) => {
      await mod.ensureAnonAuth();
      await mod.maybeConnectEmulators();
      return mod;
    });
  }
  return firebaseModulePromise;
};

const importHostLoop = async () => {
  if (!hostLoopPromise) {
    hostLoopPromise = import("../src/game/net/hostLoop.js").then((mod) => mod.startHostLoop);
  }
  return hostLoopPromise;
};

const clearFirestore = () => {
  firestoreEmulator.reset();
};

const signOut = async () => {
  await authEmulator.signOut();
};

async function withFreshEnvironment(run) {
  clearFirestore();
  await signOut();
  const firebase = await importFirebase();
  const startHostLoop = await importHostLoop();
  try {
    await run({ firebase, startHostLoop });
  } finally {
    clearFirestore();
    await signOut();
  }
}

describe("firebase arena integration (emulated)", () => {

  it("dual presence creation stores distinct auth bindings", async () => {
    await withFreshEnvironment(async ({ firebase }) => {
      const arenaId = "ARENA-DUAL";
      await firebase.ensureArenaDocument(arenaId);

      const user1 = await firebase.ensureAnonAuth();
      await firebase.joinArena(arenaId, { authUid: user1.uid, presenceId: "presence-1" }, "Alpha");

      await signOut();

      const user2 = await firebase.ensureAnonAuth();
      await firebase.joinArena(arenaId, { authUid: user2.uid, presenceId: "presence-2" }, "Bravo");

      const presenceCollection = firestoreModule.collection(firebase.db, "arenas", arenaId, "presence");
      const snapshot = await firestoreModule.getDocs(presenceCollection);
      const authUids = snapshot.docs.map((doc) => doc.data()?.authUid);

      expect(authUids.includes(user1.uid)).toBe(true);
      expect(authUids.includes(user2.uid)).toBe(true);
      expect(new Set(authUids).size).toBe(2);
    });
  });

  it("presence roster stabilizes within 2 seconds", async () => {
    await withFreshEnvironment(async ({ firebase }) => {
      const arenaId = "ARENA-STABLE";
      await firebase.ensureArenaDocument(arenaId);

      const user1 = await firebase.ensureAnonAuth();
      await firebase.joinArena(arenaId, { authUid: user1.uid, presenceId: "p1" }, "Alpha");

      await signOut();

      const user2 = await firebase.ensureAnonAuth();
      await firebase.joinArena(arenaId, { authUid: user2.uid, presenceId: "p2" }, "Bravo");

        const presenceCollection = firestoreModule.collection(firebase.db, "arenas", arenaId, "presence");
        const snapshot = await firestoreModule.getDocs(presenceCollection);
        const now = Date.now();
        const lastSeens = snapshot.docs.map((doc) => {
          const raw = doc.data()?.lastSeen;
          if (!raw) return 0;
          if (typeof raw === "number") return raw;
          if (typeof raw?.toMillis === "function") return raw.toMillis();
          if (typeof raw?.seconds === "number") {
            const seconds = raw.seconds;
            const nanos = typeof raw?.nanoseconds === "number" ? raw.nanoseconds : 0;
            return seconds * 1000 + nanos / 1_000_000;
          }
          const coerced = Number(raw);
          return Number.isFinite(coerced) ? coerced : 0;
        });

        expect(lastSeens.length === 2).toBe(true);
        const allFresh = lastSeens.every((value) => now - value <= 2000);
        expect(allFresh).toBe(true);
      });
    });

  it("input event rejects authUid mismatches", async () => {
    await withFreshEnvironment(async ({ firebase }) => {
      const arenaId = "ARENA-AUTH";
      await firebase.ensureArenaDocument(arenaId);

      const user = await firebase.ensureAnonAuth();
      const presenceId = "presence-auth";
      await firebase.joinArena(arenaId, { authUid: user.uid, presenceId }, "Alpha");

      let error;
      try {
        await firebase.writeArenaInput(arenaId, { presenceId, authUid: "wrong-user", attack: true });
      } catch (e) {
        error = e;
      }
      expect(Boolean(error)).toBe(true);
      expect(error?.code).toBe("permission-denied");

      await firebase.writeArenaInput(arenaId, { presenceId, attack: true });
      const inputs = await firebase.fetchArenaInputs(arenaId);
      expect(inputs.some((entry) => entry.presenceId === presenceId)).toBe(true);
    });
  });

  it("writer election loop produces ~12 Hz state writes", async () => {
    await withFreshEnvironment(async ({ firebase, startHostLoop }) => {
      const arenaId = "ARENA-WRITER";
      await firebase.ensureArenaDocument(arenaId);

      const user = await firebase.ensureAnonAuth();
      const presenceId = "writer-1";
      await firebase.joinArena(arenaId, { authUid: user.uid, presenceId }, "Alpha");

      const live = [
        {
          id: presenceId,
          presenceId,
          authUid: user.uid,
          playerId: presenceId,
          displayName: "Alpha",
          lastSeen: Date.now(),
        },
      ];

      const writes: number[] = [];
      const start = Date.now();

      const stopLoop = startHostLoop({
        arenaId,
        isWriter: () => true,
        getLivePresence: () => live,
        pullInputs: () => firebase.fetchArenaInputs(arenaId),
        stepSim: () => {},
        writeState: () => {
          writes.push(Date.now());
          return firebase.writeArenaState(arenaId, {
            tick: writes.length,
            writerUid: user.uid,
            lastWriter: user.uid,
            ts: Date.now(),
            entities: {},
          });
        },
      });

      await delay(250);
      stopLoop();

      const elapsed = Date.now() - start;
      const expected = Math.round((elapsed / 1000) * 12);
      const threshold = Math.max(1, expected - 2);
      expect(writes.length >= threshold).toBe(true);

      const stateSnap = await firestoreModule.getDoc(
        firestoreModule.doc(firebase.db, "arenas", arenaId, "state", "current"),
      );
      expect(stateSnap.exists()).toBe(true);
      expect(stateSnap.data()?.writerUid).toBe(user.uid);
    });
  });
});
