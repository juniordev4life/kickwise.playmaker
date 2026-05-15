import {
  getActiveArenaChallengesController,
  getArenaChallengeOverviewController,
  submitArenaLineupController
} from "../../../controllers/arena.controllers.js";
import { requireUser } from "../../../middlewares/requireUser.middlewares.js";

export default async function arenaRoutes(fastify) {
  fastify.get("/challenges", {
    preHandler: [requireUser],
    handler: getActiveArenaChallengesController.handler
  });

  fastify.get("/:challengeId/overview", {
    schema: getArenaChallengeOverviewController.schema,
    preHandler: [requireUser],
    handler: getArenaChallengeOverviewController.handler
  });

  fastify.post("/:challengeId/lineup", {
    schema: submitArenaLineupController.schema,
    preHandler: [requireUser],
    handler: submitArenaLineupController.handler
  });
}
