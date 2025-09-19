import type { InputIntent } from "../types/netcode";
import { nowMs } from "./time";

export function toIntent(kb: { seq: number; left: boolean; right: boolean; up: boolean; jump: boolean; attack: boolean }): InputIntent {
  return { left: kb.left, right: kb.right, up: kb.up, jump: kb.jump, attack: kb.attack, ts: nowMs(), seq: kb.seq };
}
