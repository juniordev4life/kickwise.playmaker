import {
  getAlternativesController,
  getBudgetLineupController
} from "../../../controllers/squad.controllers.js";

export default async function lineupRoutes(fastify) {
  // No requireUser — these endpoints don't read user squad data.
  fastify.get("/budget", {
    schema: getBudgetLineupController.schema,
    handler: getBudgetLineupController.handler
  });

  fastify.get("/alternatives", {
    schema: getAlternativesController.schema,
    handler: getAlternativesController.handler
  });
}
