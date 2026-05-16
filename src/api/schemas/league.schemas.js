export const leagueParamsSchema = {
  type: "object",
  required: ["leagueId"],
  properties: {
    leagueId: { type: "string", minLength: 1, maxLength: 64 }
  }
};

/**
 * Query schema for GET /league/:leagueId/points-history. Both bounds are
 * optional — `from` defaults to 1, `to` defaults to the current matchday
 * (resolved server-side via BigQuery). Bounds are clamped 1..34 to match
 * a full Bundesliga season.
 */
export const pointsHistoryQuerySchema = {
  type: "object",
  properties: {
    from: { type: "integer", minimum: 1, maximum: 34 },
    to: { type: "integer", minimum: 1, maximum: 34 }
  }
};
