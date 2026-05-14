import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { matchdayParamsSchema, matchdayQuerySchema } from "../schemas/matchday.schemas.js";
import {
  getCurrentMatchday,
  getCurrentSeason,
  getMatchesByMatchday
} from "../services/bigquery.services.js";

async function resolveSeasonId(querySeason) {
  if (querySeason) return querySeason;
  const current = await getCurrentSeason();
  return current?.season_id ?? null;
}

export const getCurrentMatchdayController = {
  schema: { querystring: matchdayQuerySchema },
  handler: async (request, reply) => {
    try {
      const seasonId = await resolveSeasonId(request.query.season);
      if (!seasonId) {
        return setGeneralResponse(
          reply,
          404,
          "Not Found",
          "No current season available — has the Scout run yet?",
          {}
        );
      }
      const matchday = await getCurrentMatchday(seasonId);
      const matches = await getMatchesByMatchday({ seasonId, matchday });
      return setGeneralResponse(reply, 200, "Success", "Current matchday", {
        season: seasonId,
        matchday,
        matches
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

export const getMatchdayController = {
  schema: { params: matchdayParamsSchema, querystring: matchdayQuerySchema },
  handler: async (request, reply) => {
    try {
      const seasonId = await resolveSeasonId(request.query.season);
      if (!seasonId) {
        return setGeneralResponse(reply, 404, "Not Found", "No current season available.", {});
      }
      const matchday = request.params.matchday;
      const matches = await getMatchesByMatchday({ seasonId, matchday });
      return setGeneralResponse(reply, 200, "Success", "Matchday", {
        season: seasonId,
        matchday,
        matches
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};
