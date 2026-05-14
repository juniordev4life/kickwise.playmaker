import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { leagueParamsSchema } from "../schemas/league.schemas.js";
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
