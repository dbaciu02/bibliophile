import { Router } from "express";
import { principalOf, requireAuth, SCOPES, type TokenVerifier } from "../auth.js";

/**
 * GET /api/me — who the API thinks you are, straight from the validated token.
 * Used by the frontend after login, and handy evidence for F7–F9: it shows
 * the roles and scopes the server actually accepted.
 *
 *   200 for any signed-in Reader or Curator; 401 without a valid token; 403
 *   for a valid token with no role.
 */
export function meRouter(verify: TokenVerifier): Router {
  const router = Router();
  router.get("/", requireAuth(verify, { scope: SCOPES.releasesRead, roles: ["Reader", "Curator"] }), (_req, res) => {
    const { subject, name, roles, scopes } = principalOf(res.locals);
    res.set("Cache-Control", "private, no-store");
    res.json({ subject, name, roles, scopes });
  });
  return router;
}
