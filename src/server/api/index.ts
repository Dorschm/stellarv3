import type { Application } from "express";
import express from "express";
import { logger } from "../Logger";
import { getDb } from "../userdb";
import { createAuthRouter } from "./auth";
import { getApiConfig } from "./config";
import { createRunsRouter } from "./runs";
import {
  createChangelogRouter,
  createCosmeticsRouter,
  createLeaderboardRouter,
  createStripeRouter,
} from "./stubs";
import { createPlayerRouter, createUsersRouter } from "./users";

const log = logger.child({ comp: "api" });

/**
 * Mount all self-hosted API endpoints on `app`. Idempotent; call once
 * after the static middleware is set up but before the SPA fallback so
 * specific routes win over the catch-all.
 *
 * All routes live under `/api` to keep them separate from the Vite SPA
 * fallback (any unrecognised path serves `index.html`).
 */
export function mountSelfHostedApi(app: Application): void {
  // Force the SQLite singleton to open and apply migrations during boot,
  // so the first request doesn't pay that cost or fail mid-flight.
  getDb();

  // JSON body parsing for API routes — `express.json()` is already applied
  // app-wide in Master.ts, but mounting it again under `/api` is a no-op
  // and keeps this module self-contained for other server entry points.
  app.use("/api", express.json({ limit: "1mb" }));

  app.use("/api/auth", createAuthRouter());
  app.use("/api/users", createUsersRouter());
  app.use("/api/users", createRunsRouter());
  app.use("/api/player", createPlayerRouter());
  app.use("/api", createCosmeticsRouter());
  app.use("/api", createLeaderboardRouter());
  app.use("/api", createStripeRouter());
  app.use("/api", createChangelogRouter());

  const cfg = getApiConfig();
  log.info(
    "self-hosted API mounted at /api (discord oauth %s, jwt secret %s)",
    cfg.discordClientId ? "configured" : "MISSING",
    cfg.jwtSecret ? "configured" : "MISSING",
  );
}
