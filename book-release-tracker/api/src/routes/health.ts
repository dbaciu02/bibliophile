import { Router } from "express";
import { pingDb, type Db } from "../db.js";

/**
 * GET /healthz — used by CI/CD to gate deploys (D4) and by monitoring.
 * 200 only when the app can reach its database; 503 otherwise, so a deploy
 * with a broken DB connection is never promoted.
 */

export function healthRouter(db: Db, gitSha: string): Router {
  const router = Router();

  router.get("/healthz", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      await pingDb(db);
      res.status(200).json({ status: "ok", db: "ok", commit: gitSha });
    } catch {
      res.status(503).json({ status: "unavailable", db: "unreachable", commit: gitSha });
    }
  });

  return router;
}