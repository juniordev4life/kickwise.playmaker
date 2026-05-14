/**
 * JWT-related configuration, derived from environment variables.
 *
 * @returns {{
 *   secret: string,
 *   cookieName: string,
 *   ttlDays: number,
 *   cookieSecure: boolean,
 *   cookieDomain: string|undefined
 * }}
 *
 * @example
 *   const { secret, cookieName } = getJwtConfig();
 */
export function getJwtConfig() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "change-me-to-a-256-bit-random-string") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set to a real secret in production");
    }
    console.warn("[playmaker] JWT_SECRET is unset or default — only use this in local dev");
  }
  return {
    secret: secret ?? "dev-only-fallback-secret",
    cookieName: process.env.COOKIE_NAME ?? "kickwise_token",
    ttlDays: Number.parseInt(process.env.JWT_TTL_DAYS ?? "30", 10),
    cookieSecure: (process.env.COOKIE_SECURE ?? "false").toLowerCase() === "true",
    cookieDomain: process.env.COOKIE_DOMAIN || undefined
  };
}
