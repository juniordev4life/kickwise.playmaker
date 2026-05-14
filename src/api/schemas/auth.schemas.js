export const loginBodySchema = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string", format: "email", minLength: 3, maxLength: 200 },
    password: { type: "string", minLength: 1, maxLength: 200 }
  },
  additionalProperties: false
};
