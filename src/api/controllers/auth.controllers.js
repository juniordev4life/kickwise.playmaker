import { getJwtConfig } from "../../config/jwt.config.js";
import { handleErrorResponse, setGeneralResponse } from "../helpers/responseHandler.helpers.js";
import { loginBodySchema } from "../schemas/auth.schemas.js";
import {
  clearUserSession,
  saveUserSession,
  touchUserLastSeen
} from "../services/firestore.services.js";
import { callWinger } from "../services/winger.services.js";

export const loginController = {
  schema: { body: loginBodySchema },
  handler: async (request, reply) => {
    try {
      const { email, password } = request.body;

      const wingerData = await callWinger({
        method: "POST",
        path: "/api/v1/kickbase/auth/login",
        body: { email, password },
        log: request.log
      });

      const { token: kbToken, tokenExpiry: kbTokenExp, user } = wingerData;

      await saveUserSession({
        kickbaseUserId: user.id,
        kbToken,
        kbTokenExp,
        profile: { name: user.name, avatarUrl: user.avatarUrl, leagues: user.leagues }
      });

      const jwt = await reply.jwtSign({
        sub: user.id,
        leagueIds: user.leagues.map((l) => l.id)
      });

      const cookieConfig = getJwtConfig();
      reply.setCookie(cookieConfig.cookieName, jwt, {
        path: "/",
        httpOnly: true,
        secure: cookieConfig.cookieSecure,
        sameSite: "lax",
        domain: cookieConfig.cookieDomain,
        maxAge: cookieConfig.ttlDays * 24 * 60 * 60
      });

      return setGeneralResponse(reply, 200, "Success", "Login successful", {
        user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl, leagues: user.leagues }
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

export const logoutController = {
  handler: async (request, reply) => {
    try {
      if (request.user?.kickbaseUserId) {
        await clearUserSession(request.user.kickbaseUserId);
      }
      const cookieConfig = getJwtConfig();
      reply.setCookie(cookieConfig.cookieName, "", {
        path: "/",
        httpOnly: true,
        secure: cookieConfig.cookieSecure,
        sameSite: "lax",
        domain: cookieConfig.cookieDomain,
        maxAge: 0
      });
      return setGeneralResponse(reply, 200, "Success", "Logout successful", {});
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};

export const meController = {
  handler: async (request, reply) => {
    try {
      await touchUserLastSeen(request.user.kickbaseUserId);
      return setGeneralResponse(reply, 200, "Success", "Current user", {
        kickbaseUserId: request.user.kickbaseUserId,
        leagueIds: request.user.leagueIds,
        profile: request.user.profile
      });
    } catch (error) {
      return handleErrorResponse(reply, error, request);
    }
  }
};
