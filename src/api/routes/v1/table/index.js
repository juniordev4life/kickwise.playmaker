import { getBundesligaTableController } from "../../../controllers/table.controllers.js";
import { requireUser } from "../../../middlewares/requireUser.middlewares.js";

export default async function tableRoutes(fastify) {
  fastify.get("/", {
    preHandler: [requireUser],
    handler: getBundesligaTableController.handler
  });
}
