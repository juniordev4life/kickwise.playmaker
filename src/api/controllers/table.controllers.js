import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { callWinger } from "../services/winger.services.js";

const BUNDESLIGA_COMPETITION_ID = "1";

export const getBundesligaTableController = {
  handler: async (request, reply) => {
    try {
      const data = await callWinger({
        method: "GET",
        path: `/api/v1/kickbase/competitions/${BUNDESLIGA_COMPETITION_ID}/table`,
        kbToken: request.user.kbToken,
        log: request.log
      });
      return setGeneralResponse(reply, 200, "Success", "Bundesliga table", data);
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};
