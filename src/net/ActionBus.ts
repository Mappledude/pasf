import { deleteArenaInput, writeArenaInput, type ArenaInputWrite } from "../firebase";

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
  presenceId: string;   // per-tab session id
  codename?: string;
}

interface ActionBusState {
  arenaId: string;
  presenceId: string;   // per-tab session id
  codename?: string;
  ready: boolean;
  lastSendAt: number;
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
    await writeArenaInput(state.arenaId, toWritePayload(state, payload));
  } catch (error) {
    console.warn("[INPUT] rejected", { presenceId: state.presenceId, error });
  }
}

function scheduleSend(state: ActionBusState, payload: NormalizedInput) {
  if (!state.ready) {
    return;
  }

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

  if (state.pendingTimer) {
    return;
  }

  const delay = Math.max(THROTTLE_MS - elapsed, 0);

  state.pendingTimer = setTimeout(() => {
    state.pendingTimer = undefined;

    if (!state.ready || busState !== state) {
      state.pendingPayload = undefined;
      return;
    }

    const pending = state.pendingPayload;
    state.pendingPayload = undefined;
    if (!pending) {
      return;
    }

    if (inputsEqual(pending, state.lastSentPayload)) {
      return;
    }

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
  if (!state || !state.ready) {
    return;
  }

  if (typeof input.codename === "string" && input.codename) {
    state.codename = input.codename;
  }

  const current = state.latestInput;
  const next = normalizeInput(input, current);
  if (inputsEqual(current, next)) {
    return;
  }

  state.latestInput = next;
  scheduleSend(state, next);
}

export function resetActionBus(): void {
  const state = busState;
  if (!state) {
    return;
  }

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
  if (!state) {
    return;
  }

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
