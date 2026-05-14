import {
  getLeagueRankingController,
  getMyLeaguesController
} from "../../../controllers/league.controllers.js";
import { requireUser } from "../../../middlewares/requireUser.middlewares.js";

export default async function leagueRoutes(fastify) {
  fastify.get("/me/leagues", {
    preHandler: [requireUser],
    handler: getMyLeaguesController.handler
  });

  fastify.get("/:leagueId/ranking", {
    schema: getLeagueRankingController.schema,
    preHandler: [requireUser],
    handler: getLeagueRankingController.handler
  });
}
