import { bqTable, getBigQueryClient } from "../../config/bigQuery.config.js";
import { getFirestoreClient } from "../../config/firestore.config.js";
import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { callWinger } from "../services/winger.services.js";

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
const playerParamsSchema = {
  type: "object",
  required: ["playerId"],
  properties: {
    playerId: { type: "string", pattern: "^[0-9]+$" }
  }
};

/**
 * Single-player detail. Combines the latest Firestore snapshot (current
 * market value, totals, points history) with a 30-day market-value series
 * pulled from BigQuery.
 */
export const getPlayerByIdController = {
  schema: { params: playerParamsSchema },
  handler: async (request, reply) => {
    try {
      const { playerId } = request.params;

      const db = getFirestoreClient();
      const doc = await db.collection("players").doc(playerId).get();
      if (!doc.exists) {
        return setGeneralResponse(reply, 404, "Not Found", `Player ${playerId} not found`, {});
      }
      const player = doc.data();

      const bq = getBigQueryClient();
      const [rows] = await bq.query({
        query: `
          SELECT snapshot_date, market_value, delta_24h, kickbase_total_points
          FROM \`${bqTable("kickbase_market_values")}\`
          WHERE player_id = @playerId
            AND snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
          ORDER BY snapshot_date ASC
        `,
        params: { playerId }
      });

      const marketValueHistory = rows.map((r) => ({
        date: r.snapshot_date?.value ?? r.snapshot_date,
        marketValue: r.market_value,
        delta24h: r.delta_24h,
        totalPoints: r.kickbase_total_points
      }));

      return setGeneralResponse(reply, 200, "Success", "Player retrieved", {
        player,
        marketValueHistory
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

/**
 * Returns the 18 currently active Bundesliga teams (id, name, logo). Used by
 * the Striker as a lookup table for opponent filters and per-matchday cards.
 */
export const listTeamsController = {
  handler: async (request, reply) => {
    try {
      const data = await callWinger({
        method: "GET",
        path: "/api/v1/kickbase/competitions/1/table",
        kbToken: request.user.kbToken,
        log: request.log
      });
      const teams = (data.teams ?? []).map((t) => ({
        teamId: t.teamId,
        name: t.name,
        logoUrl: t.logoUrl,
        rank: t.rank ?? null
      }));
      return setGeneralResponse(reply, 200, "Success", "Teams retrieved", { teams });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

/**
 * Multi-season matchday-by-matchday performance for a single player. Lives as
 * its own endpoint (separate from /:playerId) because it's a Kickbase live
 * call and we want the player detail page to be able to load it lazily.
 */
export const getPlayerPerformanceController = {
  schema: { params: playerParamsSchema },
  handler: async (request, reply) => {
    try {
      const data = await callWinger({
        method: "GET",
        path: `/api/v1/kickbase/competitions/1/players/${encodeURIComponent(request.params.playerId)}/performance`,
        kbToken: request.user.kbToken,
        log: request.log
      });
      return setGeneralResponse(reply, 200, "Success", "Performance retrieved", data);
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

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
