/**
 * Resolve the Winger base URL from environment.
 *
 * @returns {{ baseUrl: string, timeoutMs: number }}
 *
 * @example
 *   const { baseUrl } = getWingerConfig();
 */
export function getWingerConfig() {
  return {
    baseUrl: process.env.WINGER_URL ?? "http://localhost:3001",
    timeoutMs: Number.parseInt(process.env.WINGER_TIMEOUT_MS ?? "15000", 10)
  };
}
