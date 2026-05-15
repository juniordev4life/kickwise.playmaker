import { getBudgetLineupController } from "../../../controllers/squad.controllers.js";

export default async function lineupRoutes(fastify) {
  // No requireUser — this endpoint doesn't read user squad data.
  fastify.get("/budget", {
    schema: getBudgetLineupController.schema,
    handler: getBudgetLineupController.handler
  });
}
