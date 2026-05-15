/**
 * Resolve the Engine base URL from environment.
 *
 * @returns {{ baseUrl: string, timeoutMs: number }}
 */
export function getEngineConfig() {
  return {
    baseUrl: process.env.ENGINE_URL ?? "http://localhost:3002",
    timeoutMs: Number.parseInt(process.env.ENGINE_TIMEOUT_MS ?? "10000", 10)
  };
}
