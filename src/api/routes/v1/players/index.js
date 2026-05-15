import {
  getPlayerByIdController,
  listPlayersController
} from "../../../controllers/players.controllers.js";
import { requireUser } from "../../../middlewares/requireUser.middlewares.js";

export default async function playersRoutes(fastify) {
  fastify.get("/", {
    schema: listPlayersController.schema,
    preHandler: [requireUser],
    handler: listPlayersController.handler
  });

  fastify.get("/:playerId", {
    schema: getPlayerByIdController.schema,
    preHandler: [requireUser],
    handler: getPlayerByIdController.handler
  });
}
