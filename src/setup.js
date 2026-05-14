import path from "node:path";
import autoload from "@fastify/autoload";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { handleErrorResponse } from "./api/helpers/responseHandler.helpers.js";
import { getJwtConfig } from "./config/jwt.config.js";

/**
 * Wire Playmaker plugins, error handling, and route auto-loading.
 *
 * @param {import("fastify").FastifyInstance} server
 * @param {{ __dirname: string }} ctx
 */
export async function configureServer(server, { __dirname }) {
  const jwtConfig = getJwtConfig();

  await server.register(helmet, { contentSecurityPolicy: false });
  await server.register(cors, {
    origin: (origin, cb) => cb(null, true),
    credentials: true
  });
  await server.register(rateLimit, { max: 250, timeWindow: "1 minute" });
  await server.register(cookie);
  await server.register(jwt, {
    secret: jwtConfig.secret,
    cookie: { cookieName: jwtConfig.cookieName, signed: false },
    sign: { expiresIn: `${jwtConfig.ttlDays}d` }
  });

  server.setErrorHandler((error, request, reply) => handleErrorResponse(reply, error, request));

  server.get("/health", async () => ({
    service: "playmaker",
    status: "ok",
    timestamp: new Date().toISOString()
  }));

  await server.register(autoload, {
    dir: path.join(__dirname, "api", "routes"),
    options: { prefix: "/api" }
  });
}
