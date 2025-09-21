import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../firebase";
import { debugLog } from "./debug";

const THROTTLE_MS = 50;
const LAST_SEQ_WRITE_INTERVAL = 1500;

export interface PlayerInput {
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  attack?: boolean;
}

export interface NormalizedInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  attack: boolean;
}

export interface ActionDocument {
  id?: string;
  arenaId: string;
  playerId: string;
  seq: number;
  input: NormalizedInput;
  clientTs: number;
  createdAt?: DocumentData;
}

interface InitOptions {
  arenaId: string;
  playerId: string;
  onRemoteActions: (actions: ActionDocument[]) => void;
}

interface ActionBusState {
  arenaId: string;
  playerId: string;
  seq: number;
  onRemoteActions: (actions: ActionDocument[]) => void;
  unsubscribe?: Unsubscribe;
  ready: boolean;
  lastSendAt: number;
  lastSeqWriteAt: number;
  lastSentPayload?: NormalizedInput;
  latestInput: NormalizedInput;
  pendingPayload?: NormalizedInput;
  pendingTimer?: ReturnType<typeof setTimeout>;
}

let busState: ActionBusState | null = null;

const defaultInput: NormalizedInput = {
  left: false,
  right: false,
  jump: false,
  attack: false,
};

function normalizeInput(input: PlayerInput, base: NormalizedInput): NormalizedInput {
  return {
    left: typeof input.left === "boolean" ? input.left : base.left,
    right: typeof input.right === "boolean" ? input.right : base.right,
    jump: typeof input.jump === "boolean" ? input.jump : base.jump,
    attack: typeof input.attack === "boolean" ? input.attack : base.attack,
  };
}

function cloneNormalized(input: NormalizedInput): NormalizedInput {
  return { ...input };
}

function inputsEqual(a?: NormalizedInput, b?: NormalizedInput): boolean {
  if (!a || !b) return false;
  return a.left === b.left && a.right === b.right && a.jump === b.jump && a.attack === b.attack;
}

async function ensurePlayerStateDoc(arenaId: string, playerId: string) {
  const ref = doc(db, "arenas", arenaId, "players", playerId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(
      ref,
      {
        playerId,
        name: playerId,
        joinedAt: serverTimestamp(),
        isReady: false,
        hp: 100,
        pos: { x: 0, y: 0 },
        dir: 1,
        lastSeq: 0,
      },
      { merge: true },
    );
    return 0;
  }
  const data = snap.data() as { lastSeq?: number };
  return typeof data.lastSeq === "number" ? data.lastSeq : 0;
}

async function sendAction(state: ActionBusState, payload: NormalizedInput) {
  const seq = state.seq + 1;
  state.seq = seq;
  state.lastSentPayload = cloneNormalized(payload);
  state.lastSendAt = Date.now();
  state.pendingPayload = undefined;

  debugLog("[INPUT] upsert uid=%s pressed=%o", state.playerId, payload);

  const data = {
    arenaId: state.arenaId,
    playerId: state.playerId,
    seq,
    input: payload,
    clientTs: Date.now(),
    createdAt: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, "arenas", state.arenaId, "actions"), data);
    console.info(`[NET] sent seq=${seq}`, data);
  } catch (err) {
    console.error("[NET] send error", err);
  }

  const now = Date.now();
  if (now - state.lastSeqWriteAt > LAST_SEQ_WRITE_INTERVAL || seq % 10 === 0) {
    state.lastSeqWriteAt = now;
    try {
      await setDoc(
        doc(db, "arenas", state.arenaId, "players", state.playerId),
        { lastSeq: seq },
        { merge: true },
      );
    } catch (err) {
      console.warn("[NET] lastSeq update skipped", err);
    }
  }
}

function scheduleSend(state: ActionBusState, payload: NormalizedInput) {
  if (inputsEqual(state.lastSentPayload, payload)) {
    console.debug("[NET] dedupe", payload);
    return;
  }

  const now = Date.now();
  const elapsed = now - state.lastSendAt;
  if (elapsed >= THROTTLE_MS && !state.pendingTimer) {
    void sendAction(state, payload);
    return;
  }

  state.pendingPayload = cloneNormalized(payload);
  if (!state.pendingTimer) {
    const delay = Math.max(THROTTLE_MS - elapsed, 0);
    console.debug("[NET] throttle", { delay, payload });
    state.pendingTimer = setTimeout(() => {
      state.pendingTimer = undefined;
      const toSend = state.pendingPayload;
      state.pendingPayload = undefined;
      if (!toSend) {
        return;
      }
      if (inputsEqual(state.lastSentPayload, toSend)) {
        console.debug("[NET] dedupe", toSend);
        return;
      }
      void sendAction(state, toSend);
    }, delay);
  }
}

export async function initActionBus(options: InitOptions): Promise<void> {
  if (busState) {
    disposeActionBus();
  }

  const seq = await ensurePlayerStateDoc(options.arenaId, options.playerId);

  const state: ActionBusState = {
    arenaId: options.arenaId,
    playerId: options.playerId,
    seq,
    onRemoteActions: options.onRemoteActions,
    ready: false,
    lastSendAt: 0,
    lastSeqWriteAt: Date.now(),
    latestInput: cloneNormalized(defaultInput),
  };

  const actionsRef = collection(db, "arenas", options.arenaId, "actions");
  const q = query(actionsRef, orderBy("createdAt", "asc"));

  state.unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const batch: ActionDocument[] = [];
      snapshot.docChanges().forEach((change) => {
        if (change.type !== "added") return;
        const data = change.doc.data() as ActionDocument;
        if (!data) return;
        if (data.playerId === options.playerId) return;
        const action: ActionDocument = {
          id: change.doc.id,
          ...data,
        };
        batch.push(action);
      });
      if (batch.length > 0) {
        console.info(`[NET] recv batch size=${batch.length}`, batch);
        state.onRemoteActions(batch);
      }
    },
    (error) => {
      console.error("[NET] subscribe error", error);
    },
  );

  state.ready = true;
  busState = state;
  console.info("[NET] subscribe actions ok");
}

export function publishInput(input: PlayerInput): void {
  if (!busState || !busState.ready) {
    return;
  }

  const next = normalizeInput(input, busState.latestInput);
  if (inputsEqual(busState.latestInput, next)) {
    return;
  }

  busState.latestInput = cloneNormalized(next);
  scheduleSend(busState, next);
}

export function disposeActionBus(): void {
  if (!busState) return;
  busState.unsubscribe?.();
  if (busState.pendingTimer) {
    clearTimeout(busState.pendingTimer);
  }
  console.info("[NET] bus disposed");
  busState = null;
}
