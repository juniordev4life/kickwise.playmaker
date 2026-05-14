/**
 * JWT-related configuration, derived from environment variables.
 *
 * In production the Striker SPA lives on a different Cloud Run URL than the
 * Playmaker, so the JWT cookie has to travel cross-origin. That requires
 * SameSite=None + Secure=true. Locally (NODE_ENV !== "production") we keep
 * SameSite=Lax + Secure=false so dev over http://localhost still works.
 *
 * @returns {{
 *   secret: string,
 *   cookieName: string,
 *   ttlDays: number,
 *   cookieSecure: boolean,
 *   cookieDomain: string|undefined,
 *   cookieSameSite: "lax" | "none"
 * }}
 *
 * @example
 *   const { secret, cookieName, cookieSameSite } = getJwtConfig();
 */
export function getJwtConfig() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "change-me-to-a-256-bit-random-string") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set to a real secret in production");
    }
    console.warn("[playmaker] JWT_SECRET is unset or default — only use this in local dev");
  }
  const isProd = process.env.NODE_ENV === "production";
  return {
    secret: secret ?? "dev-only-fallback-secret",
    cookieName: process.env.COOKIE_NAME ?? "kickwise_token",
    ttlDays: Number.parseInt(process.env.JWT_TTL_DAYS ?? "30", 10),
    cookieSecure: (process.env.COOKIE_SECURE ?? (isProd ? "true" : "false")).toLowerCase() === "true",
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    cookieSameSite: (process.env.COOKIE_SAMESITE ?? (isProd ? "none" : "lax")).toLowerCase()
  };
}
