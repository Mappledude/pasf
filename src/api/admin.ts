import { httpsCallable, getFunctions } from "firebase/functions";
import { app } from "../firebase";

export interface AdminDeleteArenaResponse {
  ok: true;
  arenaId: string;
}

export interface AdminDeletePlayerResponse {
  ok: true;
  playerId: string;
  purgeRelated: boolean;
}

const functions = getFunctions(app, "us-central1");

export async function callAdminDeleteArena(arenaId: string): Promise<AdminDeleteArenaResponse> {
  const callable = httpsCallable<{ arenaId: string }, AdminDeleteArenaResponse>(functions, "adminDeleteArena");
  const result = await callable({ arenaId });
  return result.data;
}

export async function callAdminDeletePlayer(
  playerId: string,
  purgeRelated = true,
): Promise<AdminDeletePlayerResponse> {
  const callable = httpsCallable<
    { playerId: string; purgeRelated: boolean },
    AdminDeletePlayerResponse
  >(functions, "adminDeletePlayer");
  const result = await callable({ playerId, purgeRelated });
  return result.data;
}
