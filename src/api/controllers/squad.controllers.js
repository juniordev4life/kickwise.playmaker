import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { leagueParamsSchema } from "../schemas/league.schemas.js";
import { getCurrentMatchday, getCurrentSeason } from "../services/bigquery.services.js";
import {
  buildBudgetLineup,
  buildOptimizedLineup,
  FORMATIONS,
  listAlternatives,
  RISK_PROFILES
} from "../services/lineup.services.js";
import { callWinger } from "../services/winger.services.js";

export const getSquadController = {
  schema: { params: leagueParamsSchema },
  handler: async (request, reply) => {
    try {
      const data = await callWinger({
        method: "GET",
        path: `/api/v1/kickbase/squad/${encodeURIComponent(request.params.leagueId)}`,
        kbToken: request.user.kbToken,
        log: request.log
      });
      return setGeneralResponse(reply, 200, "Success", "Squad", data);
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

/**
 * GET /api/v1/squad/:leagueId/budget — proxies the user's current
 * Kickbase budget so the UI can show it instead of asking the user to
 * type their cap.
 */
export const getMyBudgetController = {
  schema: { params: leagueParamsSchema },
  handler: async (request, reply) => {
    try {
      const data = await callWinger({
        method: "GET",
        path: `/api/v1/kickbase/leagues/${encodeURIComponent(request.params.leagueId)}/me/budget`,
        kbToken: request.user.kbToken,
        log: request.log
      });
      return setGeneralResponse(reply, 200, "Success", "Budget", data ?? {});
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

const lineupQuerySchema = {
  type: "object",
  properties: {
    matchday: { type: "integer", minimum: 1, maximum: 34 },
    seasonId: { type: "string", pattern: "^\\d{4}/\\d{4}$" },
    formation: { type: "string", enum: [...Object.keys(FORMATIONS), "auto"] },
    riskProfile: { type: "string", enum: Object.keys(RISK_PROFILES) }
  }
};

export const getOptimizedLineupController = {
  schema: { params: leagueParamsSchema, querystring: lineupQuerySchema },
  handler: async (request, reply) => {
    try {
      const leagueId = request.params.leagueId;
      let seasonId = request.query.seasonId;
      let matchday = request.query.matchday;
      const formation = request.query.formation ?? "auto";

      if (!seasonId) {
        const current = await getCurrentSeason();
        seasonId = current?.season_id;
      }
      if (!matchday && seasonId) {
        matchday = await getCurrentMatchday(seasonId);
      }
      if (!seasonId || !matchday) {
        return setGeneralResponse(
          reply,
          404,
          "Not Found",
          "No current season / matchday available.",
          {}
        );
      }

      const result = await buildOptimizedLineup({
        leagueId,
        kbToken: request.user.kbToken,
        seasonId,
        matchday,
        formationKey: formation,
        riskProfileKey: request.query.riskProfile ?? "balanced",
        log: request.log
      });

      return setGeneralResponse(reply, 200, "Success", "Optimized lineup", result);
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

const budgetLineupQuerySchema = {
  type: "object",
  required: ["budget"],
  properties: {
    budget: { type: "integer", minimum: 1_000_000, maximum: 1_000_000_000 },
    matchday: { type: "integer", minimum: 1, maximum: 34 },
    seasonId: { type: "string", pattern: "^\\d{4}/\\d{4}$" },
    formation: { type: "string", enum: [...Object.keys(FORMATIONS), "auto"] },
    riskProfile: { type: "string", enum: Object.keys(RISK_PROFILES) }
  }
};

/**
 * GET /api/v1/lineup/budget — budget-constrained best XI from all Bundesliga
 * players. No login required.
 */
export const getBudgetLineupController = {
  schema: { querystring: budgetLineupQuerySchema },
  handler: async (request, reply) => {
    try {
      let seasonId = request.query.seasonId;
      let matchday = request.query.matchday;
      const formation = request.query.formation ?? "auto";
      const budget = Number(request.query.budget);

      if (!seasonId) {
        const current = await getCurrentSeason();
        seasonId = current?.season_id;
      }
      if (!matchday && seasonId) {
        matchday = await getCurrentMatchday(seasonId);
      }
      if (!seasonId || !matchday) {
        return setGeneralResponse(
          reply,
          404,
          "Not Found",
          "No current season / matchday available.",
          {}
        );
      }

      const result = await buildBudgetLineup({
        seasonId,
        matchday,
        formationKey: formation,
        budget,
        riskProfileKey: request.query.riskProfile ?? "balanced",
        log: request.log
      });
      return setGeneralResponse(reply, 200, "Success", "Budget lineup", result);
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

const alternativesQuerySchema = {
  type: "object",
  required: ["position"],
  properties: {
    position: { type: "string", enum: ["GK", "DEF", "MID", "FWD"] },
    matchday: { type: "integer", minimum: 1, maximum: 34 },
    seasonId: { type: "string", pattern: "^\\d{4}/\\d{4}$" },
    maxBudget: { type: "integer", minimum: 0 },
    excludePlayerIds: { type: "string" },
    riskProfile: { type: "string", enum: Object.keys(RISK_PROFILES) },
    limit: { type: "integer", minimum: 1, maximum: 50 }
  }
};

/**
 * GET /api/v1/lineup/alternatives — top-N replacement candidates for a
 * single position, optionally constrained by a per-player market-value
 * cap. Designed for the "click a slot → swap him" UI.
 */
export const getAlternativesController = {
  schema: { querystring: alternativesQuerySchema },
  handler: async (request, reply) => {
    try {
      let seasonId = request.query.seasonId;
      let matchday = request.query.matchday;
      if (!seasonId) {
        const current = await getCurrentSeason();
        seasonId = current?.season_id;
      }
      if (!matchday && seasonId) {
        matchday = await getCurrentMatchday(seasonId);
      }
      if (!seasonId || !matchday) {
        return setGeneralResponse(
          reply,
          404,
          "Not Found",
          "No current season / matchday available.",
          {}
        );
      }
      const excludePlayerIds = request.query.excludePlayerIds
        ? String(request.query.excludePlayerIds).split(",").filter(Boolean)
        : [];
      const result = await listAlternatives({
        seasonId,
        matchday,
        position: request.query.position,
        maxBudget: request.query.maxBudget,
        excludePlayerIds,
        riskProfileKey: request.query.riskProfile ?? "balanced",
        limit: request.query.limit ?? 20,
        log: request.log
      });
      return setGeneralResponse(reply, 200, "Success", "Alternatives", result);
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

const POSITION_ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

const submitLineupBodySchema = {
  type: "object",
  required: ["formation", "players"],
  properties: {
    formation: { type: "string", enum: Object.keys(FORMATIONS) },
    players: {
      type: "array",
      minItems: 11,
      maxItems: 11,
      items: {
        type: "object",
        required: ["playerId", "position"],
        properties: {
          playerId: { type: ["string", "number"] },
          position: { type: "string", enum: ["GK", "DEF", "MID", "FWD"] }
        }
      }
    }
  }
};

/**
 * POST /api/v1/squad/:leagueId/lineup — push the chosen XI to Kickbase.
 *
 * Marco's leagues run Arena-style rules: any Bundesliga player can be
 * fielded each matchday, no ownership constraint. We skip the squad
 * membership check and just sort the XI into the canonical slot order
 * Kickbase expects (GK first, then DEF, MID, FWD) before forwarding.
 */
export const submitLineupController = {
  schema: { params: leagueParamsSchema, body: submitLineupBodySchema },
  handler: async (request, reply) => {
    try {
      const { leagueId } = request.params;
      const { formation, players: submitted } = request.body;

      // Sort by canonical slot order: GK first, then DEF, MID, FWD.
      const ordered = [...submitted].sort(
        (a, b) => (POSITION_ORDER[a.position] ?? 9) - (POSITION_ORDER[b.position] ?? 9)
      );

      // Validate formation matches the position counts.
      const counts = ordered.reduce(
        (acc, p) => ({ ...acc, [p.position]: (acc[p.position] ?? 0) + 1 }),
        {}
      );
      const expected = FORMATIONS[formation];
      if (
        counts.GK !== 1 ||
        counts.DEF !== expected.DEF ||
        counts.MID !== expected.MID ||
        counts.FWD !== expected.FWD
      ) {
        return setGeneralResponse(
          reply,
          400,
          "Bad Request",
          `Player positions don't match formation ${formation}.`,
          { gotCounts: counts, expected: { GK: 1, ...expected } }
        );
      }

      const kickbaseResponse = await callWinger({
        method: "POST",
        path: `/api/v1/kickbase/leagues/${encodeURIComponent(leagueId)}/lineup`,
        kbToken: request.user.kbToken,
        body: {
          type: formation,
          players: ordered.map((p) => String(p.playerId))
        },
        log: request.log
      });

      return setGeneralResponse(reply, 200, "Success", "Lineup submitted to Kickbase", {
        leagueId,
        formation,
        playerCount: ordered.length,
        sentPlayerIds: ordered.map((p) => String(p.playerId)),
        kickbaseResponse
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

/**
 * Captain-only quick lookup: returns the top-3 candidates from the user's
 * squad, ranked by expected points. Designed for the matchday overview so
 * users can pick a captain without going through the full optimizer flow.
 */
export const getCaptainCandidatesController = {
  schema: { params: leagueParamsSchema, querystring: lineupQuerySchema },
  handler: async (request, reply) => {
    try {
      const leagueId = request.params.leagueId;
      let seasonId = request.query.seasonId;
      let matchday = request.query.matchday;

      if (!seasonId) {
        const current = await getCurrentSeason();
        seasonId = current?.season_id;
      }
      if (!matchday && seasonId) {
        matchday = await getCurrentMatchday(seasonId);
      }
      if (!seasonId || !matchday) {
        return setGeneralResponse(
          reply,
          404,
          "Not Found",
          "No current season / matchday available.",
          {}
        );
      }

      const optimized = await buildOptimizedLineup({
        leagueId,
        kbToken: request.user.kbToken,
        seasonId,
        matchday,
        formationKey: "auto",
        log: request.log
      });

      // Top 3 by projected expected points within the engine-picked XI.
      const candidates = [...optimized.lineup]
        .sort((a, b) => (b.expectedPoints ?? 0) - (a.expectedPoints ?? 0))
        .slice(0, 3)
        .map((p) => ({
          playerId: p.playerId,
          name: p.name,
          position: p.position,
          teamId: p.teamId,
          teamName: p.teamName ?? null,
          imageUrl: p.imageUrl ?? null,
          status: p.status ?? null,
          expectedPoints: p.expectedPoints ?? 0,
          isHome: p.matchInfo?.isHome ?? null,
          opponentTeamId: p.matchInfo?.opponentTeamId ?? null
        }));

      return setGeneralResponse(reply, 200, "Success", "Captain candidates", {
        seasonId,
        matchday,
        candidates
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};
