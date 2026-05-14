export const leagueParamsSchema = {
  type: "object",
  required: ["leagueId"],
  properties: {
    leagueId: { type: "string", minLength: 1, maxLength: 64 }
  }
};
