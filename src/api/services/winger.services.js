import { request } from "undici";
import { getWingerConfig } from "../../config/winger.config.js";

/**
 * Call a Winger endpoint. Forwards a Kickbase token as Bearer when provided.
 *
 * On Winger errors, throws an Error with `statusCode` attached so the caller
 * can react (in particular: 401 from Kickbase → re-auth flow).
 *
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.path Winger path beginning with `/`, e.g. "/api/v1/kickbase/auth/login"
 * @param {object} [opts.body]
 * @param {string} [opts.kbToken] Kickbase bearer token
 * @param {import("fastify").FastifyBaseLogger} [opts.log]
 * @returns {Promise<any>} parsed `data` payload from the Winger envelope
 *
 * @example
 *   const data = await callWinger({ method: "POST", path: "/api/v1/kickbase/auth/login", body });
 */
export async function callWinger({ method, path: apiPath, body, kbToken, log }) {
  const { baseUrl, timeoutMs } = getWingerConfig();
  const url = new URL(apiPath, baseUrl).toString();
  const headers = {
    "content-type": "application/json",
    accept: "application/json"
  };
  if (kbToken) headers.authorization = `Bearer ${kbToken}`;

  const response = await request(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    bodyTimeout: timeoutMs,
    headersTimeout: timeoutMs
  });
  const text = await response.body.text();
  const parsed = text ? JSON.parse(text) : {};

  if (response.statusCode < 200 || response.statusCode >= 300) {
    log?.warn(
      { url, statusCode: response.statusCode, errors: parsed.errors },
      "Winger error response"
    );
    const error = new Error(parsed.message ?? "Winger error");
    error.statusCode = response.statusCode;
    error.title = parsed.title ?? "Winger Error";
    error.fromWinger = true;
    throw error;
  }

  return parsed.data ?? parsed;
}
