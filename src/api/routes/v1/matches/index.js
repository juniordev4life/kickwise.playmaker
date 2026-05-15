import { getMatchByIdController } from "../../../controllers/matches.controllers.js";
import { requireUser } from "../../../middlewares/requireUser.middlewares.js";

export default async function matchesRoutes(fastify) {
  fastify.get("/:matchId", {
    schema: getMatchByIdController.schema,
    preHandler: [requireUser],
    handler: getMatchByIdController.handler
  });
}
