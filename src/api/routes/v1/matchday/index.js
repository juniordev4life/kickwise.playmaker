import {
  getCurrentMatchdayController,
  getMatchdayController
} from "../../../controllers/matchday.controllers.js";
import { requireUser } from "../../../middlewares/requireUser.middlewares.js";

export default async function matchdayRoutes(fastify) {
  fastify.get("/current", {
    schema: getCurrentMatchdayController.schema,
    preHandler: [requireUser],
    handler: getCurrentMatchdayController.handler
  });

  fastify.get("/:matchday", {
    schema: getMatchdayController.schema,
    preHandler: [requireUser],
    handler: getMatchdayController.handler
  });
}
