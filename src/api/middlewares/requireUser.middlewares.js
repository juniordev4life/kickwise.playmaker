import { getUserSession } from "../services/firestore.services.js";

/**
 * Verify the JWT cookie and attach the resolved user + Kickbase token to the
 * request as `request.user`. If anything is missing or invalid, reject with 401.
 *
 * Sets `request.user` to:
 *   { kickbaseUserId, leagueIds, kbToken, profile }
 *
 * @param {import("fastify").FastifyRequest} request
 * @param {import("fastify").FastifyReply} reply
 *
 * @example
 *   fastify.get("/...", { preHandler: [requireUser] }, handler);
 */
export async function requireUser(request, reply) {
  try {
    const payload = await request.jwtVerify({ onlyCookie: true });
    const kickbaseUserId = payload.sub;
    const session = await getUserSession(kickbaseUserId);

    if (!session.kbToken) {
      return reply.status(401).send({
        traceId: request.id,
        code: 401,
        title: "Kickbase Re-Auth Required",
        message: "No Kickbase token on file. Please log in again.",
        data: {},
        errors: ["KICKBASE_REAUTH_REQUIRED"]
      });
    }

    request.user = {
      kickbaseUserId,
      leagueIds: payload.leagueIds ?? [],
      kbToken: session.kbToken,
      profile: session.profile
    };
  } catch (_err) {
    return reply.status(401).send({
      traceId: request.id,
      code: 401,
      title: "Unauthorized",
      message: "Invalid or missing session.",
      data: {},
      errors: ["UNAUTHORIZED"]
    });
  }
}
