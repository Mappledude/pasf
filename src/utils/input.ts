import type { MutableRefObject } from "react";
import type { InputIntent } from "../types/netcode";
import type { KeyIntentState } from "../game/input/KeyBinder";
import { nowMs } from "./time";

const FALLBACK_STATE: KeyIntentState = {
  left: false,
  right: false,
  up: false,
  jump: false,
  attack: false,
  seq: 0,
};

export function sampleKeyboardIntent(keysRef: MutableRefObject<KeyIntentState | null | undefined>): InputIntent {
  const state = keysRef.current ?? FALLBACK_STATE;
  return {
    left: !!state.left,
    right: !!state.right,
    up: !!state.up,
    jump: !!state.jump,
    attack: !!state.attack,
    ts: nowMs(),
    seq: state.seq,
  };
}
