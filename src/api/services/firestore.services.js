import { getFirestoreClient } from "../../config/firestore.config.js";

const USERS = "users";

/**
 * Persist (or overwrite) the Kickbase token and profile for a user.
 *
 * @param {object} payload
 * @param {string} payload.kickbaseUserId
 * @param {string} payload.kbToken
 * @param {string|null} payload.kbTokenExp
 * @param {object} payload.profile normalized profile from Winger
 * @returns {Promise<void>}
 *
 * @example
 *   await saveUserSession({ kickbaseUserId, kbToken, kbTokenExp, profile });
 */
export async function saveUserSession({ kickbaseUserId, kbToken, kbTokenExp, profile }) {
  const db = getFirestoreClient();
  const now = new Date();
  await db.collection(USERS).doc(kickbaseUserId).set(
    {
      kbToken,
      kbTokenExp,
      profile,
      lastSeen: now,
      updatedAt: now,
      createdAt: now
    },
    { merge: true }
  );
}

/**
 * Look up the current Kickbase token for a user.
 *
 * @param {string} kickbaseUserId
 * @returns {Promise<{kbToken: string|null, kbTokenExp: string|null, profile: object|null}>}
 *
 * @example
 *   const session = await getUserSession(uid);
 */
export async function getUserSession(kickbaseUserId) {
  const db = getFirestoreClient();
  const snap = await db.collection(USERS).doc(kickbaseUserId).get();
  if (!snap.exists) {
    return { kbToken: null, kbTokenExp: null, profile: null };
  }
  const data = snap.data() ?? {};
  return {
    kbToken: data.kbToken ?? null,
    kbTokenExp: data.kbTokenExp ?? null,
    profile: data.profile ?? null
  };
}

/**
 * Mark a session as logged out (clears the stored Kickbase token).
 *
 * @param {string} kickbaseUserId
 * @returns {Promise<void>}
 *
 * @example
 *   await clearUserSession(uid);
 */
export async function clearUserSession(kickbaseUserId) {
  const db = getFirestoreClient();
  await db.collection(USERS).doc(kickbaseUserId).set(
    {
      kbToken: null,
      kbTokenExp: null,
      loggedOutAt: new Date()
    },
    { merge: true }
  );
}

/**
 * Bump the lastSeen timestamp for a user without overwriting other fields.
 *
 * @param {string} kickbaseUserId
 * @returns {Promise<void>}
 *
 * @example
 *   await touchUserLastSeen(uid);
 */
export async function touchUserLastSeen(kickbaseUserId) {
  const db = getFirestoreClient();
  await db.collection(USERS).doc(kickbaseUserId).set({ lastSeen: new Date() }, { merge: true });
}
