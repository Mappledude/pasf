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

function scheduleSend(state: ActionBus
)
