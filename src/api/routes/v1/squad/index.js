import { getSquadController } from "../../../controllers/squad.controllers.js";
import { requireUser } from "../../../middlewares/requireUser.middlewares.js";

export default async function squadRoutes(fastify) {
  fastify.get("/:leagueId", {
    schema: getSquadController.schema,
    preHandler: [requireUser],
    handler: getSquadController.handler
  });
}
