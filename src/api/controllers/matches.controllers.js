import { bqTable, getBigQueryClient } from "../../config/bigQuery.config.js";
import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { fetchPrediction } from "../services/engine.services.js";
import { fetchMatchDetail } from "../services/openligadb.services.js";

const matchParamsSchema = {
  type: "object",
  required: ["matchId"],
  properties: {
    matchId: { type: "string", pattern: "^[0-9]+$" }
  }
};

/**
 * Single-match detail. Returns openligadb (score, half-time score, goals)
 * joined with Understat xG/shots/PPDA from BigQuery when available.
 */
export const getMatchByIdController = {
  schema: { params: matchParamsSchema },
  handler: async (request, reply) => {
    try {
      const matchId = request.params.matchId;
      const match = await fetchMatchDetail(matchId);

      // Best-effort xG lookup — never fails the whole response if BQ is empty
      try {
        const xgByTeam = await fetchXgForMatch(matchId);
        match.homeStats = xgByTeam[match.homeTeam.teamId] ?? null;
        match.awayStats = xgByTeam[match.awayTeam.teamId] ?? null;
      } catch (xgErr) {
        request.log.warn({ matchId, err: xgErr.message }, "xG lookup failed");
        match.homeStats = null;
        match.awayStats = null;
      }

      // Best-effort prediction — Engine may be unreachable, model may lack data
      match.prediction = await fetchPrediction({ matchId, log: request.log });

      return setGeneralResponse(reply, 200, "Success", "Match retrieved", { match });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

async function fetchXgForMatch(matchId) {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `
      SELECT team_id, is_home, xg, xga, shots, shots_on_target, deep_passes, ppda
      FROM \`${bqTable("xg_match_data")}\`
      WHERE match_id = @matchId
    `,
    params: { matchId }
  });
  const out = {};
  for (const r of rows) {
    out[r.team_id] = {
      xg: r.xg,
      xga: r.xga,
      shots: r.shots,
      shotsOnTarget: r.shots_on_target,
      deepPasses: r.deep_passes,
      ppda: r.ppda
    };
  }
  return out;
}
