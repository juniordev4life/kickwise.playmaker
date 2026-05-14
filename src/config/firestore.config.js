import { Firestore } from "@google-cloud/firestore";

let cached;

/**
 * Return a cached Firestore client. Respects FIRESTORE_EMULATOR_HOST.
 *
 * @returns {Firestore}
 *
 * @example
 *   const db = getFirestoreClient();
 *   await db.collection("users").doc("u1").set({ ... });
 */
export function getFirestoreClient() {
  if (!cached) {
    cached = new Firestore({
      projectId: process.env.GCP_PROJECT_ID ?? process.env.BQ_PROJECT_ID
    });
  }
  return cached;
}
