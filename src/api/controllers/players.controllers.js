import { getFirestoreClient } from "../../config/firestore.config.js";
import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";

const ALLOWED_POSITIONS = new Set(["GK", "DEF", "MID", "FWD"]);
const ALLOWED_SORTS = new Set(["marketValue", "averagePoints", "totalPoints", "name"]);

const playersQuerySchema = {
  type: "object",
  properties: {
    position: { type: "string" },
    teamId: { type: "string" },
    minMarketValue: { type: "integer", minimum: 0 },
    maxMarketValue: { type: "integer", minimum: 0 },
    minAveragePoints: { type: "number", minimum: 0 },
    sortBy: { type: "string", enum: ["marketValue", "averagePoints", "totalPoints", "name"] },
    sortDir: { type: "string", enum: ["asc", "desc"] },
    limit: { type: "integer", minimum: 1, maximum: 500 }
  },
  additionalProperties: false
};

/**
 * Player-list endpoint. Reads the latest snapshot from Firestore's `players`
 * collection (populated nightly by Scout) and applies the requested filters
 * and sorting in memory — the collection is small enough (~490 docs) that
 * this is cheaper and simpler than Firestore composite indexes.
 *
 * Query params: position, teamId, minMarketValue, maxMarketValue,
 * minAveragePoints, sortBy, sortDir, limit.
 */
export const listPlayersController = {
  schema: { querystring: playersQuerySchema },
  handler: async (request, reply) => {
    try {
      const db = getFirestoreClient();
      const snap = await db.collection("players").get();

      let players = snap.docs.map((d) => d.data());

      const q = request.query;
      if (q.position && ALLOWED_POSITIONS.has(q.position)) {
        players = players.filter((p) => p.position === q.position);
      }
      if (q.teamId) {
        players = players.filter((p) => p.teamId === q.teamId);
      }
      if (typeof q.minMarketValue === "number") {
        players = players.filter((p) => (p.marketValue ?? 0) >= q.minMarketValue);
      }
      if (typeof q.maxMarketValue === "number") {
        players = players.filter((p) => (p.marketValue ?? 0) <= q.maxMarketValue);
      }
      if (typeof q.minAveragePoints === "number") {
        players = players.filter((p) => (p.averagePoints ?? 0) >= q.minAveragePoints);
      }

      const sortBy = ALLOWED_SORTS.has(q.sortBy) ? q.sortBy : "marketValue";
      const dir = q.sortDir === "asc" ? 1 : -1;
      players.sort((a, b) => {
        const av = a[sortBy] ?? (sortBy === "name" ? "" : 0);
        const bv = b[sortBy] ?? (sortBy === "name" ? "" : 0);
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });

      const limit = q.limit ?? 100;
      const total = players.length;
      players = players.slice(0, limit);

      return setGeneralResponse(reply, 200, "Success", "Players retrieved", {
        total,
        returned: players.length,
        sortBy,
        sortDir: dir === 1 ? "asc" : "desc",
        players
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};
