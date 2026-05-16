import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { leagueParamsSchema, pointsHistoryQuerySchema } from "../schemas/league.schemas.js";
import { getCurrentMatchday, getCurrentSeason } from "../services/bigquery.services.js";
import { getCached, setCached } from "../services/cache.services.js";
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

const RANKING_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch a single matchday's ranking snapshot, with caching. Caches by
 * `ranking:{leagueId}:{day}` so repeat dashboard loads don't hammer
 * Kickbase. Errors are caught and returned as `null` so a single bad
 * matchday doesn't kill the entire history Promise.all.
 *
 * @param {object} args
 * @param {string} args.leagueId
 * @param {number} args.day
 * @param {string} args.kbToken
 * @param {import("pino").Logger} [args.log]
 * @returns {Promise<{ day: number, snapshot: object | null }>}
 */
async function fetchRankingForDay({ leagueId, day, kbToken, log }) {
  const cacheKey = `ranking:${leagueId}:${day}`;
  const cached = getCached(cacheKey);
  if (cached) return { day, snapshot: cached };
  try {
    const snapshot = await callWinger({
      method: "GET",
      path: `/api/v1/kickbase/leagues/${encodeURIComponent(leagueId)}/ranking?day=${day}`,
      kbToken,
      log
    });
    setCached(cacheKey, snapshot, RANKING_CACHE_TTL_MS);
    return { day, snapshot };
  } catch (err) {
    log?.warn({ err: err?.message, leagueId, day }, "Ranking snapshot failed for day");
    return { day, snapshot: null };
  }
}

/**
 * Detect whether Kickbase honored the `?day=N` query parameter on the
 * ranking endpoint. We compare the earliest and latest fetched matchdays'
 * matchdayPoints signatures — if they're byte-identical, Kickbase ignored
 * the param and returned the current snapshot for every request. The
 * frontend uses this flag to render a fallback message.
 *
 * @param {Array<{ day: number, snapshot: object | null }>} results
 * @returns {boolean}
 *
 * @example
 *   const ok = detectKickbaseHonor(results);
 *   if (!ok) log.warn("Kickbase ignored ?day=N — chart will show flat line");
 */
function detectKickbaseHonor(results) {
  const valid = results.filter((r) => r.snapshot?.entries?.length);
  if (valid.length < 2) return true;
  const first = valid[0].snapshot.entries;
  const last = valid[valid.length - 1].snapshot.entries;
  if (first.length !== last.length) return true;
  const firstSig = first
    .map((e) => `${e.userId}:${e.matchdayPoints}`)
    .sort()
    .join("|");
  const lastSig = last
    .map((e) => `${e.userId}:${e.matchdayPoints}`)
    .sort()
    .join("|");
  return firstSig !== lastSig;
}

/**
 * GET /api/v1/league/:leagueId/points-history
 *
 * Returns per-matchday points history for every member of the league,
 * plus a computed league-average series. Drives the dashboard line chart
 * "you vs. league average across matchdays".
 *
 * Loops `/api/v1/kickbase/leagues/{id}/ranking?day=N` for N in
 * [from..to] using Promise.all + 5min in-memory cache. Default range is
 * 1..currentMatchday (resolved from BigQuery).
 *
 * Response shape:
 *   {
 *     leagueId: "L123",
 *     matchdays: [1, 2, ..., N],
 *     leagueAverage: [number | null, ...],     // mean of matchdayPoints per day
 *     users: [{ userId, name, totalPoints, points: [number | null, ...] }],
 *     kickbaseHonorsDay: boolean               // false => fallback in UI
 *   }
 *
 * @example
 *   GET /api/v1/league/L123/points-history                  // 1..current
 *   GET /api/v1/league/L123/points-history?from=10&to=20    // window
 */
export const getLeaguePointsHistoryController = {
  schema: { params: leagueParamsSchema, querystring: pointsHistoryQuerySchema },
  handler: async (request, reply) => {
    try {
      const { leagueId } = request.params;
      const fromMatchday = request.query.from ?? 1;
      let toMatchday = request.query.to;

      if (!toMatchday) {
        const season = await getCurrentSeason().catch(() => null);
        const current = season?.season_id
          ? await getCurrentMatchday(season.season_id).catch(() => null)
          : null;
        toMatchday = current?.matchday ?? 1;
      }

      if (fromMatchday > toMatchday) {
        return setGeneralResponse(reply, 400, "Bad Request", "`from` must be <= `to`", {});
      }

      const days = [];
      for (let d = fromMatchday; d <= toMatchday; d++) days.push(d);

      const results = await Promise.all(
        days.map((day) =>
          fetchRankingForDay({
            leagueId,
            day,
            kbToken: request.user.kbToken,
            log: request.log
          })
        )
      );

      // Aggregate into per-user history matrix
      const userMap = new Map();
      for (const { day, snapshot } of results) {
        if (!snapshot?.entries) continue;
        for (const entry of snapshot.entries) {
          if (!userMap.has(entry.userId)) {
            userMap.set(entry.userId, {
              userId: entry.userId,
              name: entry.name ?? "",
              totalPoints: Number(entry.totalPoints ?? 0),
              points: new Map()
            });
          }
          const user = userMap.get(entry.userId);
          user.points.set(day, Number(entry.matchdayPoints ?? 0));
          // Latest snapshot wins for totalPoints + name (handles mid-season rename)
          user.totalPoints = Number(entry.totalPoints ?? 0);
          user.name = entry.name ?? user.name;
        }
      }

      const users = Array.from(userMap.values())
        .map((u) => ({
          userId: u.userId,
          name: u.name,
          totalPoints: u.totalPoints,
          points: days.map((d) => (u.points.has(d) ? u.points.get(d) : null))
        }))
        .sort((a, b) => b.totalPoints - a.totalPoints);

      // Compute league average per matchday
      const leagueAverage = days.map((_, idx) => {
        const values = users
          .map((u) => u.points[idx])
          .filter((v) => typeof v === "number" && Number.isFinite(v));
        if (!values.length) return null;
        return values.reduce((a, b) => a + b, 0) / values.length;
      });

      const kickbaseHonorsDay = detectKickbaseHonor(results);

      return setGeneralResponse(reply, 200, "Success", "Points history retrieved", {
        leagueId,
        matchdays: days,
        leagueAverage,
        users,
        kickbaseHonorsDay
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};
