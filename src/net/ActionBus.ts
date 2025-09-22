// src/net/ActionBus.ts
import type { Firestore } from "firebase/firestore";
import { addDoc, collection } from "firebase/firestore";
import type { FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";

export type InputPayload = {
  type: string;
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  attack?: boolean;
  attackSeq?: number;
  codename?: string;
  // allow extra flags, but they won't all be persisted
  [k: string]: unknown;
};

/**
 * Write a single input event under arenas/{arenaId}/inputs/{presenceId}/events
 * Stamps authUid and clientTs. Validations happen on the host loop.
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
