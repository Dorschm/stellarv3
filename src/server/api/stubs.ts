import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RankedType } from "../../core/game/Game";
import { logger } from "../Logger";

const log = logger.child({ comp: "api-stubs" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Endpoints that the client expects to exist but that have no real
 * implementation in this self-hosted deployment yet. Each one returns a
 * shape-correct empty payload (or 501 for purchase flow) so the client
 * code paths continue to work and degrade gracefully.
 *
 * Replace these with real implementations as features come online — every
 * route here is intentionally trivial so it's obvious what to swap in.
 */

export function createCosmeticsRouter(): Router {
  const router = Router();
  // Empty cosmetics catalog. The client validates with `CosmeticsSchema`
  // (src/core/CosmeticSchemas.ts) which accepts empty pattern/flag arrays.
  router.get("/cosmetics.json", (_req, res) => {
    res.json({
      patterns: [],
      flags: [],
    });
  });
  return router;
}

export function createLeaderboardRouter(): Router {
  const router = Router();
  const now = new Date().toISOString();
  router.get("/leaderboard/ranked", (_req, res) => {
    res.json({
      [RankedType.OneVOne]: [],
    });
  });
  router.get("/leaderboard/players", (_req, res) => {
    res.json({ players: [] });
  });
  router.get("/leaderboard/clans", (_req, res) => {
    res.json({ start: now, end: now, clans: [] });
  });
  router.get("/public/clans/leaderboard", (_req, res) => {
    res.json({ start: now, end: now, clans: [] });
  });
  return router;
}

export function createStripeRouter(): Router {
  const router = Router();
  // Purchase flow is intentionally disabled. Returning 501 lets the client
  // surface a "not available" message — and lets a future implementation
  // drop in without changing the route.
  router.post("/stripe/create-checkout-session", (_req, res) => {
    res.status(501).json({ error: "purchases_not_implemented" });
  });
  return router;
}

export function createChangelogRouter(): Router {
  const router = Router();
  router.get("/changelog.md", (_req, res) => {
    // Serve the changelog file checked into the repo if present, otherwise
    // return an empty markdown body so the NewsModal still renders.
    const candidates = [
      path.resolve(__dirname, "../../../resources/changelog.md"),
      path.resolve(process.cwd(), "resources/changelog.md"),
    ];
    for (const p of candidates) {
      try {
        const body = fs.readFileSync(p, "utf8");
        res.type("text/markdown").send(body);
        return;
      } catch {
        // Try the next candidate.
      }
    }
    log.debug("changelog.md not found; serving empty body");
    res.type("text/markdown").send("");
  });
  return router;
}
