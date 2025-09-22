// src/net/ActionBus.ts
import type { Firestore } from "firebase/firestore";
import { addDoc, collection } from "firebase/firestore";
import type { FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { db, app } from "../firebase";


export type InputPayload = {
  type: string;
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  attack?: boolean;
  attackSeq?: number;
  codename?: string;
  [k: string]: unknown;
};

/**
 * Enqueue a player input under:
 *   arenas/{arenaId}/inputs/{presenceId}/events
 * Stamps authUid + clientTs. Host loop validates & applies.
 */
export async function writeArenaInput(
  db: Firestore,
  app: FirebaseApp,
  arenaId: string,
  presenceId: string,
  input: InputPayload
): Promise<void> {
  const authUid = getAuth(app).currentUser?.uid;
  if (!authUid) throw new Error("no-auth");

  const events = collection(db, "arenas", arenaId, "inputs", presenceId, "events");
  const payload: Record<string, unknown> = {
    type: input.type,
    presenceId,
    authUid,
    clientTs: Date.now(),
    applied: false,
  };

  if (typeof input.left === "boolean") payload.left = input.left;
  if (typeof input.right === "boolean") payload.right = input.right;
  if (typeof input.jump === "boolean") payload.jump = input.jump;
  if (typeof input.attack === "boolean") payload.attack = input.attack;
  if (typeof input.attackSeq === "number") payload.attackSeq = input.attackSeq;
  if (typeof input.codename === "string" && input.codename) payload.codename = input.codename;

  await addDoc(events, payload);
  console.info("[INPUT] enqueue", { presenceId, type: input.type });
}
type ArenaInputWrite = {
  presenceId: string;
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  attack?: boolean;
  attackSeq?: number;
  codename?: string;
};

function toWritePayload(state: ActionBusState, input: NormalizedInput): ArenaInputWrite {
  return {
    presenceId: state.presenceId,
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
    // FIXED: pass db & app to match writeArenaInput signature
    await writeArenaInput(db, app, state.arenaId, state.presenceId, toWritePayload(state, payload));
  } catch (error) {
    console.warn("[INPUT] rejected", { presenceId: state.presenceId, error });
  }
}

function scheduleSend(state: ActionBusState, payload: NormalizedInput) {
  if (!state.ready) return;

  const nextPayload = cloneNormalized(payload);

  if (inputsEqual(nextPayload, state.lastSentPayload)) {
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = undefined;
    }
    state.pendingPayload = undefined;
    return;
  }

  const now = Date.now();
  const elapsed = now - state.lastSendAt;

  if (elapsed >= THROTTLE_MS) {
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = undefined;
    }
    state.pendingPayload = undefined;
    void sendInput(state, nextPayload);
    return;
  }

  state.pendingPayload = nextPayload;

  if (state.pendingTimer) return;

  const delay = Math.max(THROTTLE_MS - elapsed, 0);

  state.pendingTimer = setTimeout(() => {
    state.pendingTimer = undefined;

    if (!state.ready || busState !== state) {
      state.pendingPayload = undefined;
      return;
    }

    const pending = state.pendingPayload;
    state.pendingPayload = undefined;
    if (!pending) return;

    if (inputsEqual(pending, state.lastSentPayload)) return;

    void sendInput(state, pending);
  }, delay);
}

export async function initActionBus(options: InitOptions): Promise<void> {
  if (busState && busState.pendingTimer) {
    clearTimeout(busState.pendingTimer);
  }

  const initialInput = cloneNormalized(defaultInput);

  const state: ActionBusState = {
    arenaId: options.arenaId,
    presenceId: options.presenceId,
    codename: options.codename,
    ready: true,
    lastSendAt: 0,
    lastSentPayload: undefined,
    latestInput: cloneNormalized(initialInput),
    pendingPayload: undefined,
    pendingTimer: undefined,
  };

  busState = state;

  await sendInput(state, initialInput);
}

export function publishInput(input: PlayerInput): void {
  const state = busState;
  if (!state || !state.ready) return;

  if (typeof input.codename === "string" && input.codename) {
    state.codename = input.codename;
  }

  const current = state.latestInput;
  const next = normalizeInput(input, current);
  if (inputsEqual(current, next)) return;

  state.latestInput = next;
  scheduleSend(state, next);
}

export function resetActionBus(): void {
  const state = busState;
  if (!state) return;

  if (state.pendingTimer) {
    clearTimeout(state.pendingTimer);
    state.pendingTimer = undefined;
  }

  state.latestInput = cloneNormalized(defaultInput);
  state.lastSentPayload = undefined;
  state.lastSendAt = 0;
  state.pendingPayload = undefined;
  scheduleSend(state, state.latestInput);
}

export function disposeActionBus(): void {
  const state = busState;
  if (!state) return;

  state.ready = false;

  if (state.pendingTimer) {
    clearTimeout(state.pendingTimer);
    state.pendingTimer = undefined;
  }

  const { arenaId, presenceId } = state;
  busState = null;

  void deleteArenaInput(arenaId, presenceId).catch((error) => {
    console.warn("[INPUT] delete failed", { presenceId, error });
  });
}

