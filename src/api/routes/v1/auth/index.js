import {
  loginController,
  logoutController,
  meController
} from "../../../controllers/auth.controllers.js";
import { requireUser } from "../../../middlewares/requireUser.middlewares.js";

export default async function authRoutes(fastify) {
  fastify.post("/login", {
    schema: loginController.schema,
    handler: loginController.handler
  });

  fastify.post("/logout", {
    preHandler: [requireUser],
    handler: logoutController.handler
  });

  fastify.get("/me", {
    preHandler: [requireUser],
    handler: meController.handler
  });
}
