import { listTeamsController } from "../../../controllers/players.controllers.js";
import { requireUser } from "../../../middlewares/requireUser.middlewares.js";

export default async function teamsRoutes(fastify) {
  fastify.get("/", {
    preHandler: [requireUser],
    handler: listTeamsController.handler
  });
}
