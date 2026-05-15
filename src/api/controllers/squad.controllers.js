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
    formation: { type: "string", enum: Object.keys(FORMATIONS) }
  }
};

export const getOptimizedLineupController = {
  schema: { params: leagueParamsSchema, querystring: lineupQuerySchema },
  handler: async (request, reply) => {
    try {
      const leagueId = request.params.leagueId;
      let seasonId = request.query.seasonId;
      let matchday = request.query.matchday;
      const formation = request.query.formation ?? "4-4-2";

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
