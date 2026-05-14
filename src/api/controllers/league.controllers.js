import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { leagueParamsSchema } from "../schemas/league.schemas.js";
import { callWinger } from "../services/winger.services.js";

export const getLeagueRankingController = {
  schema: { params: leagueParamsSchema },
  handler: async (request, reply) => {
    try {
      const data = await callWinger({
        method: "GET",
        path: `/api/v1/kickbase/leagues/${encodeURIComponent(request.params.leagueId)}/ranking`,
        kbToken: request.user.kbToken,
        log: request.log
      });
      return setGeneralResponse(reply, 200, "Success", "League ranking", data);
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

export const getMyLeaguesController = {
  handler: async (request, reply) => {
    try {
      // Kickbase's login response doesn't include the user's leagues — those
      // live behind a separate /v4/leagues/selection call. We fetch them live
      // on every request so the user always sees freshly joined/left leagues.
      const data = await callWinger({
        method: "GET",
        path: "/api/v1/kickbase/leagues",
        kbToken: request.user.kbToken,
        log: request.log
      });
      return setGeneralResponse(reply, 200, "Success", "Leagues", data);
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};
