export const matchdayParamsSchema = {
  type: "object",
  required: ["matchday"],
  properties: {
    matchday: { type: "integer", minimum: 1, maximum: 38 }
  }
};

export const matchdayQuerySchema = {
  type: "object",
  properties: {
    season: { type: "string", pattern: "^\\d{4}/\\d{4}$" }
  },
  additionalProperties: false
};
