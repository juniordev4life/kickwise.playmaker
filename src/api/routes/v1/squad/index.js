import {
  getCaptainCandidatesController,
  getOptimizedLineupController,
  getSquadController
} from "../../../controllers/squad.controllers.js";
import { requireUser } from "../../../middlewares/requireUser.middlewares.js";

export default async function squadRoutes(fastify) {
  fastify.get("/:leagueId", {
    schema: getSquadController.schema,
    preHandler: [requireUser],
    handler: getSquadController.handler
  });

  fastify.get("/:leagueId/lineup", {
    schema: getOptimizedLineupController.schema,
    preHandler: [requireUser],
    handler: getOptimizedLineupController.handler
  });

  fastify.get("/:leagueId/captain-candidates", {
    schema: getCaptainCandidatesController.schema,
    preHandler: [requireUser],
    handler: getCaptainCandidatesController.handler
  });
}
