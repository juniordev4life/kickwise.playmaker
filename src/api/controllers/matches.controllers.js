import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { fetchMatchDetail } from "../services/openligadb.services.js";

const matchParamsSchema = {
  type: "object",
  required: ["matchId"],
  properties: {
    matchId: { type: "string", pattern: "^[0-9]+$" }
  }
};

/**
 * Single-match detail via openligadb (Stufe 2A — score, half time score,
 * goals timeline). xG/possession/passes come in later stages from
 * Understat and FBref adapters.
 */
export const getMatchByIdController = {
  schema: { params: matchParamsSchema },
  handler: async (request, reply) => {
    try {
      const match = await fetchMatchDetail(request.params.matchId);
      return setGeneralResponse(reply, 200, "Success", "Match retrieved", { match });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};
