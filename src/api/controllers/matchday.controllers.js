import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { kickbaseTeamNameToOpenligadbName } from "../helpers/teamMapping.helpers.js";
import { matchdayParamsSchema, matchdayQuerySchema } from "../schemas/matchday.schemas.js";
import {
  getCurrentMatchday,
  getCurrentSeason,
  getMatchesByMatchday
} from "../services/bigquery.services.js";
import { callWinger } from "../services/winger.services.js";

const BUNDESLIGA_COMPETITION_ID = "1";

async function resolveSeasonId(querySeason) {
  if (querySeason) return querySeason;
  const current = await getCurrentSeason();
  return current?.season_id ?? null;
}

/**
 * Fetch the live Kickbase table and build a `openligadbTeamName → rank` map
 * so we can decorate matches with current league positions. Returns an empty
 * map on any error so missing-rank fallback in the UI still works.
 */
async function loadRankByOpenligadbName({ kbToken, log }) {
  try {
    const data = await callWinger({
      method: "GET",
      path: `/api/v1/kickbase/competitions/${BUNDESLIGA_COMPETITION_ID}/table`,
      kbToken,
      log
    });
    const map = new Map();
    for (const team of data?.teams ?? []) {
      if (team.rank == null) continue;
      const canonical = kickbaseTeamNameToOpenligadbName(team.name);
      if (canonical) map.set(canonical, team.rank);
    }
    return map;
  } catch (err) {
    log?.warn({ err: err?.message }, "Could not load Kickbase table for rank decoration");
    return new Map();
  }
}

function decorateWithRanks(matches, rankByName) {
  if (rankByName.size === 0) return matches;
  return matches.map((m) => ({
    ...m,
    home_team_rank: rankByName.get(m.home_team_name) ?? null,
    away_team_rank: rankByName.get(m.away_team_name) ?? null
  }));
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
      const [matches, rankByName] = await Promise.all([
        getMatchesByMatchday({ seasonId, matchday }),
        loadRankByOpenligadbName({ kbToken: request.user.kbToken, log: request.log })
      ]);
      return setGeneralResponse(reply, 200, "Success", "Current matchday", {
        season: seasonId,
        matchday,
        matches: decorateWithRanks(matches, rankByName)
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
      const [matches, rankByName] = await Promise.all([
        getMatchesByMatchday({ seasonId, matchday }),
        loadRankByOpenligadbName({ kbToken: request.user.kbToken, log: request.log })
      ]);
      return setGeneralResponse(reply, 200, "Success", "Matchday", {
        season: seasonId,
        matchday,
        matches: decorateWithRanks(matches, rankByName)
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};
