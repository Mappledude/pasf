import type { FirebaseApp } from "firebase/app";
import type { Firestore } from "firebase/firestore";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { app, db, deleteArenaInput, ensureAnonAuth } from "../firebase";

const THROTTLE_MS = 60;

export interface PlayerInput {
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  attack?: boolean;
  codename?: string;
  attackSeq?: number;
}

interface NormalizedInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  attack: boolean;
  attackSeq: number;
}

interface InitOptions {
  arenaId: string;
  presenceId: string; // per-tab session id
  codename?: string;
}

interface ActionBusState {
  arenaId: string;
  presenceId: string; // per-tab session id
  codename?: string;
  ready: boolean;
  lastSendAt: number;
  lastSentPayload?: NormalizedInput;
  latestInput: NormalizedInput;
  pendingPayload?: NormalizedInput;
  pendingTimer?: ReturnType<typeof setTimeout>;
}

interface InputPayload {
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  attack?: boolean;
  codename?: string;
  attackSeq?: number;
}

let busState: ActionBusState | null = null;

async function writeArenaInput(
  firestore: Firestore,
  firebaseApp: FirebaseApp,
  arenaId: string,
  presenceId: string,
  payload: InputPayload,
): Promise<void> {
  await ensureAnonAuth();

  const auth = getAuth(firebaseApp);
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("No authenticated user");
  }

  const ref = doc(firestore, "arenas", arenaId, "inputs", presenceId);
  const data: Record<string, unknown> = {
    playerId: presenceId,
    presenceId,
    authUid: uid,
    updatedAt: serverTimestamp(),
  };

  if (typeof payload.left === "boolean") data.left = payload.left;
  if (typeof payload.right === "boolean") data.right = payload.right;
  if (typeof payload.jump === "boolean") data.jump = payload.jump;
  if (typeof payload.attack === "boolean") data.attack = payload.attack;
  if (typeof payload.attackSeq === "number") data.attackSeq = payload.attackSeq;
  if (typeof payload.codename === "string") data.codename = payload.codename;

  await setDoc(ref, data, { merge: true });
}

const defaultInput: NormalizedInput = {
  left: false,
  right: false,
  jump: false,
  attack: false,
  attackSeq: 0,
};

function normalizeInput(input: PlayerInput, base: NormalizedInput): NormalizedInput {
  return {
    left: typeof input.left === "boolean" ? input.left : base.left,
    right: typeof input.right === "boolean" ? input.right : base.right,
    jump: typeof input.jump === "boolean" ? input.jump : base.jump,
    attack: typeof input.attack === "boolean" ? input.attack : base.attack,
    attackSeq: typeof input.attackSeq === "number" ? input.attackSeq : base.attackSeq,
  };
}

function cloneNormalized(input: NormalizedInput): NormalizedInput {
  return { ...input };
}

function inputsEqual(a?: NormalizedInput, b?: NormalizedInput): boolean {
  if (!a || !b) return false;
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.jump === b.jump &&
    a.attack === b.attack &&
    a.attackSeq === b.attackSeq
  );
}

function toWritePayload(state: ActionBusState, input: NormalizedInput): InputPayload {
  return {
    left: input.left,
    right: input.right,
    jump: input.jump,
    attack: input.attack,
    attackSeq: input.attackSeq,
    codename: state.codename,
  };
}

async function sendInput(state: ActionBusState, payload: NormalizedInput) {
  state.lastSentPayload = cloneNormalized(payload);
  state.lastSendAt = Date.now();
  state.pendingPayload = undefined;

  try {
    const seq = payload.attackSeq;
    console.info("[INPUT] write", { presenceId: state.presenceId, seq });
    await writeArenaInput(db, app, state.arenaId, state.presenceId, toWritePayload(state, payload));
  } catch (error) {
    console.warn("[INPUT] rejected", { presenceId: state.presenceId, error });
  }
}

function scheduleSend(state: ActionBusState, payload: NormalizedInput) {
  const now = Date.now();
  const elapsed = now - state.lastSendAt;

  if (elapsed >= THROTTLE_MS) {
    void sendInput(state, payload);
    return;
  }

  state.pendingPayload = cloneNormalized(payload);

  if (state.pendingTimer) {
    return;
  }

  const delay = Math.max(THROTTLE_MS - elapsed, 0);
  state.pendingTimer = setTimeout(() => {
    state.pendingTimer = undefined;
    const pending = state.pendingPayload;
    if (!pending) return;
    state.pendingPayload = undefined;
    void sendInput(state, pending);
  }, delay);
}

export async function initActionBus(options: InitOptions): Promise<void> {
  disposeActionBus();

  const initialInput = cloneNormalized(defaultInput);
  const state: ActionBusState = {
    arenaId: options.arenaId,
    presenceId: options.presenceId,
    codename: options.codename,
    ready: false,
    lastSendAt: 0,
    latestInput: initialInput,
  };

  busState = state;

  try {
    await writeArenaInput(db, app, state.arenaId, state.presenceId, toWritePayload(state, initialInput));
    state.lastSentPayload = cloneNormalized(initialInput);
    state.lastSendAt = Date.now();
  } catch (error) {
    console.warn("[INPUT] init write failed", { presenceId: state.presenceId, error });
  } finally {
    state.ready = true;
  }
}

export function publishInput(input: PlayerInput): void {
  const state = busState;
  if (!state || !state.ready) return;

  if (typeof input.codename === "string" && input.codename.length > 0) {
    state.codename = input.codename;
  }

  const normalized = normalizeInput(input, state.latestInput ?? defaultInput);
  if (inputsEqual(normalized, state.latestInput)) {
    return;
  }

  state.latestInput = cloneNormalized(normalized);

  if (inputsEqual(normalized, state.lastSentPayload)) {
    return;
  }

  scheduleSend(state, normalized);
}

export function disposeActionBus(): void {
  const state = busState;
  if (!state) return;

  if (state.pendingTimer) {
    clearTimeout(state.pendingTimer);
  }

  busState = null;

  void (async () => {
    try {
      await deleteArenaInput(state.arenaId, state.presenceId);
    } catch (error) {
      console.warn("[INPUT] delete failed", { presenceId: state.presenceId, error });
    }
  })();
}
