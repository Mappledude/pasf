import { deleteArenaInput, writeArenaInput, type ArenaInputWrite } from "../firebase";

const THROTTLE_MS = 100;

export interface PlayerInput {
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  attack?: boolean;
  codename?: string;
}

interface NormalizedInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  attack: boolean;
}

interface InitOptions {
  arenaId: string;
  playerId: string;
  codename?: string;
}

interface ActionBusState {
  arenaId: string;
  playerId: string;
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

function toWritePayload(input: NormalizedInput, codename?: string): ArenaInputWrite {
  return {
    left: input.left,
    right: input.right,
    jump: input.jump,
    attack: input.attack,
    codename,
  };
}

async function sendInput(state: ActionBusState, payload: NormalizedInput) {
  state.lastSentPayload = cloneNormalized(payload);
  state.lastSendAt = Date.now();
  state.pendingPayload = undefined;

  try {
    await writeArenaInput(state.arenaId, state.playerId, toWritePayload(payload, state.codename));
  } catch (error) {
    console.warn("[NET] input publish failed", error);
  }
}

function scheduleSend(state: ActionBusState, payload: NormalizedInput) {
  if (inputsEqual(state.lastSentPayload, payload)) return;

  const now = Date.now();
  const elapsed = now - state.lastSendAt;

  if (elapsed >= THROTTLE_MS && !state.pendingTimer) {
    void sendInput(state, payload);
    return;
  }

  state.pendingPayload = cloneNormalized(payload);

  if (!state.pendingTimer) {
    const delay = Math.max(THROTTLE_MS - elapsed, 0);
    state.pendingTimer = setTimeout(() => {
      state.pendingTimer = undefined;
      const toSend = state.pendingPayload;
      state.pendingPayload = undefined;
      if (!toSend) return;
      if (inputsEqual(state.lastSentPayload, toSend)) return;
      void sendInput(state, toSend);
    }, delay);
  }
}

export async function initActionBus(options: InitOptions): Promise<void> {
  if (busState) {
    disposeActionBus();
  }

  const state: ActionBusState = {
    arenaId: options.arenaId,
    playerId: options.playerId,
    codename: options.codename,
    ready: true,
    lastSendAt: 0,
    latestInput: cloneNormalized(defaultInput),
  };

  busState = state;

  try {
    // Seed doc so host loop can read a known key immediately
    await writeArenaInput(options.arenaId, options.playerId, toWritePayload(defaultInput, options.codename));
  } catch (error) {
    console.warn("[NET] initial input publish skipped", error);
  }
}

export function publishInput(input: PlayerInput): void {
  if (!busState || !busState.ready) return;

  if (input.codename) {
    busState.codename = input.codename;
  }

  const next = normalizeInput(input, busState.latestInput);
  if (inputsEqual(busState.latestInput, next)) return;

  busState.latestInput = cloneNormalized(next);
  scheduleSend(busState, next);
}

export function disposeActionBus(): void {
  if (!busState) return;
  const { arenaId, playerId } = busState;
  if (busState.pendingTimer) {
    clearTimeout(busState.pendingTimer);
  }
  busState = null;
  void deleteArenaInput(arenaId, playerId).catch((error) => {
    console.warn("[NET] input dispose cleanup failed", error);
  });
}
