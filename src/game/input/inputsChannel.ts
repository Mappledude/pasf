import { publishInput } from "../../net/InputPublisher";

export type InputKey = "left" | "right" | "up" | "jump" | "attack1" | "attack2";

export type InputState = Record<InputKey, boolean>;

export type InputSnapshot = InputState & { seq: number };

export type InputSource = symbol;

type Listener = (snapshot: InputSnapshot) => void;

const INPUT_KEYS: InputKey[] = ["left", "right", "up", "jump", "attack1", "attack2"];

const INITIAL_STATE: InputState = {
  left: false,
  right: false,
  up: false,
  jump: false,
  attack1: false,
  attack2: false,
};

const sources = new Map<InputSource, InputState>();
let aggregate: InputSnapshot = { ...INITIAL_STATE, seq: 0 };
const listeners = new Set<Listener>();

function cloneState(state: InputState): InputState {
  return { ...state };
}

function computeAggregate(): InputState {
  const next: InputState = { ...INITIAL_STATE };
  for (const state of sources.values()) {
    for (const key of INPUT_KEYS) {
      if (state[key]) {
        next[key] = true;
      }
    }
  }
  return next;
}

function emitIfChanged(next: InputState) {
  let changed = false;
  for (const key of INPUT_KEYS) {
    if (aggregate[key] !== next[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) {
    return;
  }
  aggregate = { ...next, seq: aggregate.seq + 1 };
  const snapshot = { ...aggregate };
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn("[inputs] listener error", error);
    }
  }
  publishInput({
    left: aggregate.left,
    right: aggregate.right,
    jump: aggregate.jump || aggregate.up,
    attack: aggregate.attack1 || aggregate.attack2,
  });
}

function ensureSource(source: InputSource): InputState {
  const existing = sources.get(source);
  if (existing) {
    return existing;
  }
  const state = cloneState(INITIAL_STATE);
  sources.set(source, state);
  return state;
}

export function createInputSource(label?: string): InputSource {
  const source: InputSource = Symbol(label ?? "input-source");
  sources.set(source, cloneState(INITIAL_STATE));
  return source;
}

export function updateInputSource(source: InputSource, partial: Partial<InputState>): void {
  const current = ensureSource(source);
  const next = { ...current };
  let mutated = false;
  for (const [key, value] of Object.entries(partial)) {
    if (!INPUT_KEYS.includes(key as InputKey)) {
      continue;
    }
    const typedKey = key as InputKey;
    const boolValue = !!value;
    if (next[typedKey] !== boolValue) {
      next[typedKey] = boolValue;
      mutated = true;
    }
  }
  if (!mutated) {
    return;
  }
  sources.set(source, next);
  const aggregateNext = computeAggregate();
  emitIfChanged(aggregateNext);
}

export function clearInputSource(source: InputSource): void {
  if (!sources.has(source)) {
    return;
  }
  sources.delete(source);
  const aggregateNext = computeAggregate();
  emitIfChanged(aggregateNext);
}

export function getInputSnapshot(): InputSnapshot {
  return { ...aggregate };
}

export function subscribeInputs(listener: Listener): () => void {
  listeners.add(listener);
  listener({ ...aggregate });
  return () => {
    listeners.delete(listener);
  };
}

export function resetInputs(): void {
  aggregate = { ...INITIAL_STATE, seq: aggregate.seq + 1 };
  sources.clear();
  const snapshot = { ...aggregate };
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn("[inputs] listener error", error);
    }
  }
  publishInput({ left: false, right: false, jump: false, attack: false });
}
