import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

const { HttpsError } = functions.https;

type CallableContext = functions.https.CallableContext;

type DeleteByQueryOptions = {
  limit?: number;
};

async function deleteByQuery(
  query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>,
  options: DeleteByQueryOptions = {},
): Promise<number> {
  const batchSize = Math.max(1, Math.min(options.limit ?? 250, 500));
  let totalDeleted = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snapshot = await query.limit(batchSize).get();
    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    totalDeleted += snapshot.size;

    if (snapshot.size < batchSize) {
      break;
    }
  }

  return totalDeleted;
}

function assertAdmin(context: CallableContext): asserts context is CallableContext & {
  auth: NonNullable<CallableContext["auth"]> & {
    token: NonNullable<CallableContext["auth"]>["token"] & { admin?: boolean };
  };
} {
  const isAdmin = Boolean(context.auth?.token && (context.auth.token as { admin?: boolean }).admin === true);
  if (!isAdmin) {
    throw new HttpsError("permission-denied", "Admin privileges required");
  }
}

function sanitizeId(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpsError("invalid-argument", `${field} cannot be empty`);
  }

  return trimmed;
}

export interface AdminDeleteArenaResponse {
  ok: true;
  arenaId: string;
}

export interface AdminDeletePlayerResponse {
  ok: true;
  playerId: string;
  purgeRelated: boolean;
}

export const adminDeleteArena = functions
  .region("us-central1")
  .https.onCall(async (data, context): Promise<AdminDeleteArenaResponse> => {
    assertAdmin(context);

    const arenaId = sanitizeId(data?.arenaId, "arenaId");
    const arenaRef = db.collection("arenas").doc(arenaId);

    const subcollections = ["presence", "seats", "inputs", "state"] as const;

    for (const sub of subcollections) {
      await deleteByQuery(arenaRef.collection(sub));
    }

    await arenaRef.delete().catch((error) => {
      if ((error as { code?: number }).code === 5) {
        // Firestore NOT_FOUND; ignore for idempotency
        return;
      }
      throw error;
    });

    functions.logger.info("adminDeleteArena", { arenaId });

    return { ok: true, arenaId };
  });

export const adminDeletePlayer = functions
  .region("us-central1")
  .https.onCall(async (data, context): Promise<AdminDeletePlayerResponse> => {
    assertAdmin(context);

    const playerId = sanitizeId(data?.playerId, "playerId");
    const purgeRelated = data?.purgeRelated !== false;

    await db.collection("players").doc(playerId).delete().catch((error) => {
      if ((error as { code?: number }).code === 5) {
        return;
      }
      throw error;
    });

    if (purgeRelated) {
      await deleteByQuery(
        db
          .collectionGroup("seats")
          .where("uid", "==", playerId),
      );
      await deleteByQuery(
        db
          .collectionGroup("presence")
          .where("authUid", "==", playerId),
      );
    }

    functions.logger.info("adminDeletePlayer", { playerId, purgeRelated });

    return { ok: true, playerId, purgeRelated };
  });

