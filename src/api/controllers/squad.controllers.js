import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { leagueParamsSchema } from "../schemas/league.schemas.js";
import { getCurrentMatchday, getCurrentSeason } from "../services/bigquery.services.js";
import { buildOptimizedLineup, FORMATIONS } from "../services/lineup.services.js";
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

const lineupQuerySchema = {
  type: "object",
  properties: {
    matchday: { type: "integer", minimum: 1, maximum: 34 },
    seasonId: { type: "string", pattern: "^\\d{4}/\\d{4}$" },
    formation: { type: "string", enum: [...Object.keys(FORMATIONS), "auto"] }
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
        log: request.log
      });

      return setGeneralResponse(reply, 200, "Success", "Optimized lineup", result);
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
