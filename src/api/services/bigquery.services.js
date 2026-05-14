import { bqTable, getBigQueryClient } from "../../config/bigQuery.config.js";

/**
 * Return all matches for a given matchday in a given season.
 *
 * @param {object} params
 * @param {string} params.seasonId e.g. "2024/2025"
 * @param {number} params.matchday e.g. 30
 * @returns {Promise<Array<object>>} match rows
 *
 * @example
 *   const matches = await getMatchesByMatchday({ seasonId: "2024/2025", matchday: 30 });
 */
export async function getMatchesByMatchday({ seasonId, matchday }) {
  const bq = getBigQueryClient();
  const sql = `
    SELECT
      m.match_id, m.season_id, m.matchday,
      m.home_team_id, m.away_team_id,
      m.kickoff_at, m.home_score, m.away_score, m.status,
      th.name AS home_team_name, th.short_name AS home_team_short, th.logo_url AS home_logo_url,
      ta.name AS away_team_name, ta.short_name AS away_team_short, ta.logo_url AS away_logo_url
    FROM \`${bqTable("matches")}\` m
    LEFT JOIN \`${bqTable("teams")}\` th ON m.home_team_id = th.team_id
    LEFT JOIN \`${bqTable("teams")}\` ta ON m.away_team_id = ta.team_id
    WHERE m.season_id = @seasonId AND m.matchday = @matchday
    ORDER BY m.kickoff_at ASC
  `;
  const [rows] = await bq.query({
    query: sql,
    params: { seasonId, matchday }
  });
  return rows;
}

/**
 * Return all teams currently tracked.
 *
 * @returns {Promise<Array<object>>}
 *
 * @example
 *   const teams = await getAllTeams();
 */
export async function getAllTeams() {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `SELECT team_id, name, short_name, league, logo_url FROM \`${bqTable("teams")}\` ORDER BY name ASC`
  });
  return rows;
}

/**
 * Return the season marked as current. Falls back to the lexicographically largest
 * season-id (which sorts correctly for the "YYYY/YYYY+1" format).
 *
 * @returns {Promise<{season_id: string, start_date: string, end_date: string}|null>}
 *
 * @example
 *   const season = await getCurrentSeason();
 */
export async function getCurrentSeason() {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `
      SELECT season_id, start_date, end_date
      FROM \`${bqTable("seasons")}\`
      WHERE is_current = TRUE
      LIMIT 1
    `
  });
  if (rows.length > 0) return rows[0];
  const [fallback] = await bq.query({
    query: `
      SELECT season_id, start_date, end_date
      FROM \`${bqTable("seasons")}\`
      ORDER BY season_id DESC
      LIMIT 1
    `
  });
  return fallback[0] ?? null;
}

/**
 * Determine which matchday is "current" — typically the next matchday that has
 * unfinished matches.
 *
 * @param {string} seasonId
 * @returns {Promise<number>}
 *
 * @example
 *   const md = await getCurrentMatchday("2024/2025");
 */
export async function getCurrentMatchday(seasonId) {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `
      SELECT MIN(matchday) AS matchday
      FROM \`${bqTable("matches")}\`
      WHERE season_id = @seasonId AND status != 'finished'
    `,
    params: { seasonId }
  });
  if (rows.length === 0 || rows[0].matchday === null) {
    const [fallback] = await bq.query({
      query: `
        SELECT MAX(matchday) AS matchday
        FROM \`${bqTable("matches")}\`
        WHERE season_id = @seasonId
      `,
      params: { seasonId }
    });
    return fallback[0]?.matchday ?? 1;
  }
  return rows[0].matchday;
}
