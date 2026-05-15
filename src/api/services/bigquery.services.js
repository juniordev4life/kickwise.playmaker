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
    WITH latest_predictions AS (
      SELECT match_id, model_version, prob_home_win, prob_draw, prob_away_win,
             expected_home_goals, expected_away_goals, run_at,
             ROW_NUMBER() OVER (PARTITION BY match_id ORDER BY run_at DESC) AS rn
      FROM \`${bqTable("predictions")}\`
    )
    SELECT
      m.match_id, m.season_id, m.matchday,
      m.home_team_id, m.away_team_id,
      m.kickoff_at, m.home_score, m.away_score, m.status,
      th.name AS home_team_name, th.short_name AS home_team_short, th.logo_url AS home_logo_url,
      ta.name AS away_team_name, ta.short_name AS away_team_short, ta.logo_url AS away_logo_url,
      p.model_version AS prediction_model_version,
      p.prob_home_win AS prediction_prob_home_win,
      p.prob_draw AS prediction_prob_draw,
      p.prob_away_win AS prediction_prob_away_win,
      p.expected_home_goals AS prediction_expected_home_goals,
      p.expected_away_goals AS prediction_expected_away_goals,
      p.run_at AS prediction_run_at
    FROM \`${bqTable("matches")}\` m
    LEFT JOIN \`${bqTable("teams")}\` th ON m.home_team_id = th.team_id
    LEFT JOIN \`${bqTable("teams")}\` ta ON m.away_team_id = ta.team_id
    LEFT JOIN latest_predictions p ON p.match_id = m.match_id AND p.rn = 1
    WHERE m.season_id = @seasonId AND m.matchday = @matchday
    ORDER BY m.kickoff_at ASC
  `;
  const [rows] = await bq.query({
    query: sql,
    params: { seasonId, matchday }
  });
  return rows.map(reshapeMatchRow);
}

function reshapeMatchRow(row) {
  const hasPrediction =
    row.prediction_prob_home_win !== null && row.prediction_prob_home_win !== undefined;
  return {
    match_id: row.match_id,
    season_id: row.season_id,
    matchday: row.matchday,
    home_team_id: row.home_team_id,
    away_team_id: row.away_team_id,
    kickoff_at: row.kickoff_at,
    home_score: row.home_score,
    away_score: row.away_score,
    status: row.status,
    home_team_name: row.home_team_name,
    home_team_short: row.home_team_short,
    home_logo_url: row.home_logo_url,
    away_team_name: row.away_team_name,
    away_team_short: row.away_team_short,
    away_logo_url: row.away_logo_url,
    prediction: hasPrediction
      ? {
          modelVersion: row.prediction_model_version,
          probHomeWin: row.prediction_prob_home_win,
          probDraw: row.prediction_prob_draw,
          probAwayWin: row.prediction_prob_away_win,
          expectedHomeGoals: row.prediction_expected_home_goals,
          expectedAwayGoals: row.prediction_expected_away_goals,
          runAt: row.prediction_run_at
        }
      : null
  };
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

/**
 * Per-player form statistics over the last ~50 played matchdays:
 *   - playedCount: matches played (sample size)
 *   - avg:         mean Kickbase points
 *   - std:         population stddev of points
 *   - recentMax:   highest score in the most recent 5 played matchdays
 *   - cov:         coefficient of variation (std / avg) — volatility
 *   - ceiling:     recentMax / avg — recent upside relative to baseline
 *
 * Used by the risk-profile adjustments: bold boosts ceiling players, while
 * conservative penalises high-cov (volatile) players.
 *
 * @returns {Promise<Map<string, object>>} keyed by player_id
 *
 * @example
 *   const stats = await loadPlayerFormStats();
 *   stats.get("12345").ceiling // ≈ 1.5 if their recent peak is 50% above avg
 */
export async function loadPlayerFormStats() {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `
      WITH base AS (
        SELECT player_id, season_id, matchday, points
        FROM \`${bqTable("kickbase_player_points")}\`
        WHERE has_played = TRUE
          AND source = 'kickbase-performance'
          AND points IS NOT NULL
          AND season_id IN (
            SELECT season_id FROM \`${bqTable("seasons")}\`
            ORDER BY season_id DESC LIMIT 2
          )
      ),
      ranked AS (
        SELECT player_id, points, matchday, season_id,
               ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY season_id DESC, matchday DESC) AS rn
        FROM base
      )
      SELECT
        b.player_id,
        COUNT(*) AS played,
        AVG(b.points) AS avg_pts,
        STDDEV_POP(b.points) AS std_pts,
        (SELECT MAX(r.points) FROM ranked r WHERE r.player_id = b.player_id AND r.rn <= 5) AS recent_max
      FROM base b
      GROUP BY b.player_id
    `
  });
  const map = new Map();
  for (const r of rows) {
    const avg = Number(r.avg_pts ?? 0);
    const std = Number(r.std_pts ?? 0);
    const recentMax = Number(r.recent_max ?? 0);
    map.set(String(r.player_id), {
      playedCount: Number(r.played ?? 0),
      avg,
      std,
      recentMax,
      cov: avg > 0 ? std / avg : 0,
      ceiling: avg > 0 ? recentMax / avg : 1
    });
  }
  return map;
}
