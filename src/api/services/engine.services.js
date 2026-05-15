import { request } from "undici";
import { getEngineConfig } from "../../config/engine.config.js";

/**
 * Fetch a Poisson-xG prediction for a match from the Engine service. Returns
 * `null` on any failure (Engine offline, 404, timeout) so callers can degrade
 * gracefully — predictions are best-effort enrichment, never load-bearing.
 *
 * @param {object} opts
 * @param {string} opts.matchId
 * @param {import("fastify").FastifyBaseLogger} [opts.log]
 * @returns {Promise<object|null>}
 *
 * @example
 *   const p = await fetchPrediction({ matchId: "12345" });
 *   if (p) match.prediction = p;
 */
export async function fetchPrediction({ matchId, log }) {
  const { baseUrl, timeoutMs } = getEngineConfig();
  const url = new URL(`/api/v1/predictions/${matchId}`, baseUrl).toString();
  try {
    const response = await request(url, {
      method: "GET",
      headers: { accept: "application/json" },
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      log?.warn({ matchId, status: response.statusCode }, "Engine prediction non-2xx");
      return null;
    }
    const text = await response.body.text();
    const parsed = text ? JSON.parse(text) : {};
    return parsed?.data?.prediction ?? null;
  } catch (err) {
    log?.warn({ matchId, err: err.message }, "Engine prediction call failed");
    return null;
  }
}
