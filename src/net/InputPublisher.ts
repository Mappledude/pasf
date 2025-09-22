import { app, db } from "../firebase";
import { writeArenaInput, type InputPayload } from "./ActionBus";
import { dbg } from "../lib/debug";

const THROTTLE_MS = 60;

type PublishContext = {
  arenaId: string;
  presenceId: string;
  codename?: string;
};

type NormalizedInput = {
  left: boolean;
  right: boolean;
  jump: boolean;
  attack: boolean;
  attackSeq: number;
  codename?: string;
};

let context: PublishContext | null = null;
let lastSent: NormalizedInput | null = null;
let lastSendAt = 0;
let pending: NormalizedInput | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

const defaultState = (): NormalizedInput => ({
  left: false,
  right: false,
  jump: false,
  attack: false,
  attackSeq: 0,
  codename: context?.codename,
});

const normalizeInput = (
  input: Partial<NormalizedInput>,
  base: NormalizedInput,
): NormalizedInput => ({
  left: typeof input.left === "boolean" ? input.left : base.left,
  right: typeof input.right === "boolean" ? input.right : base.right,
  jump: typeof input.jump === "boolean" ? input.jump : base.jump,
  attack: typeof input.attack === "boolean" ? input.attack : base.attack,
  attackSeq: typeof input.attackSeq === "number" ? input.attackSeq : base.attackSeq,
  codename: typeof input.codename === "string" && input.codename.length > 0 ? input.codename : base.codename,
});

const inputsEqual = (a: NormalizedInput | null, b: NormalizedInput | null): boolean => {
  if (!a || !b) return false;
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.jump === b.jump &&
    a.attack === b.attack &&
    a.attackSeq === b.attackSeq &&
    a.codename === b.codename
  );
};

const toPayload = (input: NormalizedInput): InputPayload => ({
  type: "input",
  left: input.left,
  right: input.right,
  jump: input.jump,
  attack: input.attack,
  attackSeq: input.attackSeq,
  codename: input.codename,
});

const flushPending = (next: NormalizedInput) => {
  if (!context) return;
  pending = null;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  lastSent = { ...next };
  lastSendAt = Date.now();

  const payload = toPayload(next);
  if (!payload.codename && context.codename) {
    payload.codename = context.codename;
  }

  dbg("input:enqueue", {
    arenaId: context.arenaId,
    presenceId: context.presenceId,
    type: payload.type,
  });
  void writeArenaInput(db, app, context.arenaId, context.presenceId, payload).catch((error) => {
    console.warn("[INPUT] enqueue failed", error);
  });
};

const scheduleFlush = (next: NormalizedInput) => {
  pending = next;
  if (pendingTimer) return;
  const delay = Math.max(0, THROTTLE_MS - (Date.now() - lastSendAt));
  pendingTimer = setTimeout(() => {
    if (!pending) {
      pendingTimer = null;
      return;
    }
    const payload = pending;
    pending = null;
    pendingTimer = null;
    flushPending(payload);
  }, delay);
};

export const initInputPublisher = (options: PublishContext) => {
  context = { ...options, codename: options.codename ?? undefined };
  lastSent = null;
  lastSendAt = 0;
  pending = null;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
};

export const disposeInputPublisher = () => {
  context = null;
  lastSent = null;
  pending = null;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
};

export const publishInput = (input: Partial<NormalizedInput>) => {
  if (!context) {
    return;
  }

  const base = pending ?? lastSent ?? defaultState();
  const next = normalizeInput(input, base);
  if (inputsEqual(lastSent, next)) {
    return;
  }

  const elapsed = Date.now() - lastSendAt;
  if (elapsed >= THROTTLE_MS) {
    flushPending(next);
    return;
  }

  scheduleFlush(next);
};
