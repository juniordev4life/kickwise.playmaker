import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { FORMATIONS } from "../services/lineup.services.js";
import { callWinger } from "../services/winger.services.js";

const POSITION_ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

/**
 * GET /api/v1/arena/challenges — proxy to Winger's challenges/selection +
 * overview. Returns whatever Kickbase gives us back, raw, so the UI can
 * pick the right challenge to submit against. Useful for diagnostics
 * until we understand the exact response shape.
 */
export const getActiveArenaChallengesController = {
  handler: async (request, reply) => {
    try {
      const [selection, overview] = await Promise.all([
        callWinger({
          method: "GET",
          path: "/api/v1/kickbase/challenges/selection",
          kbToken: request.user.kbToken,
          log: request.log
        }).catch((err) => ({ error: err.message })),
        callWinger({
          method: "GET",
          path: "/api/v1/kickbase/challenges/overview",
          kbToken: request.user.kbToken,
          log: request.log
        }).catch((err) => ({ error: err.message }))
      ]);
      return setGeneralResponse(reply, 200, "Success", "Arena challenges", {
        selection,
        overview
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

/**
 * GET /api/v1/arena/:challengeId/overview — raw lineup overview for a
 * challenge. Returned as-is so we can inspect the response and figure out
 * the participant/group ids needed for submit.
 */
export const getArenaChallengeOverviewController = {
  schema: {
    params: {
      type: "object",
      required: ["challengeId"],
      properties: { challengeId: { type: "string", minLength: 1 } }
    }
  },
  handler: async (request, reply) => {
    try {
      const { challengeId } = request.params;
      const data = await callWinger({
        method: "GET",
        path: `/api/v1/kickbase/challenges/${encodeURIComponent(challengeId)}/lineup/overview`,
        kbToken: request.user.kbToken,
        log: request.log
      });
      return setGeneralResponse(reply, 200, "Success", "Challenge overview", data ?? {});
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

const submitArenaLineupSchema = {
  params: {
    type: "object",
    required: ["challengeId"],
    properties: { challengeId: { type: "string", minLength: 1 } }
  },
  body: {
    type: "object",
    required: ["formation", "players"],
    properties: {
      formation: { type: "string", enum: Object.keys(FORMATIONS) },
      players: {
        type: "array",
        minItems: 11,
        maxItems: 11,
        items: {
          type: "object",
          required: ["playerId", "position"],
          properties: {
            playerId: { type: ["string", "number"] },
            position: { type: "string", enum: ["GK", "DEF", "MID", "FWD"] }
          }
        }
      },
      pi: { type: ["string", "null"] },
      gid: { type: ["string", "null"] }
    }
  }
};

/**
 * POST /api/v1/arena/:challengeId/lineup — push an Arena lineup to
 * Kickbase. Unlike the classical squad submit there's no ownership check
 * (Arena lets the user pick from the full pool each matchday). Forwards
 * to the Winger /challenges/:id/lineup proxy which in turn POSTs to
 * /v4/challenges/{id}/join.
 */
export const submitArenaLineupController = {
  schema: submitArenaLineupSchema,
  handler: async (request, reply) => {
    try {
      const { challengeId } = request.params;
      const { formation, players, pi, gid } = request.body;

      const ordered = [...players].sort(
        (a, b) => (POSITION_ORDER[a.position] ?? 9) - (POSITION_ORDER[b.position] ?? 9)
      );
      const playerIds = ordered.map((p) => String(p.playerId));

      const data = await callWinger({
        method: "POST",
        path: `/api/v1/kickbase/challenges/${encodeURIComponent(challengeId)}/lineup`,
        kbToken: request.user.kbToken,
        body: { type: formation, players: playerIds, pi: pi ?? null, gid: gid ?? null },
        log: request.log
      });

      return setGeneralResponse(reply, 200, "Success", "Arena lineup submitted", {
        challengeId,
        formation,
        playerCount: playerIds.length,
        kickbaseResponse: data ?? {}
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};
