import { Router } from "express";
import { z } from "zod";
import { PersistedRunScoreSchema } from "../../core/ApiSchemas";
import { insertRun, listRunsForUser } from "../userdb";
import { requireAuthUser } from "./authMiddleware";

function rowToApi(row: ReturnType<typeof listRunsForUser>[number]) {
  return {
    id: row.id,
    totalTicks: row.totalTicks,
    winCondition: row.winCondition,
    players: row.players,
    date: row.date,
    mapSeed: row.mapSeed,
    mapName: row.mapName,
    result: row.result,
  };
}

export function createRunsRouter(): Router {
  const router = Router();

  // GET /users/@me/runs — newest-first run history
  router.get("/@me/runs", requireAuthUser, (req, res) => {
    const user = req.authUser!;
    const runs = listRunsForUser(user.id);
    res.json({ runs: runs.map(rowToApi) });
  });

  // POST /users/@me/runs — push a single run
  router.post("/@me/runs", requireAuthUser, (req, res) => {
    const user = req.authUser!;
    const parsed = PersistedRunScoreSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_run_payload",
        details: z.prettifyError(parsed.error),
      });
      return;
    }
    const data = parsed.data;
    insertRun({
      id: data.id,
      userId: user.id,
      totalTicks: data.totalTicks,
      winCondition: data.winCondition,
      result: data.result,
      players: data.players,
      date: data.date,
      mapSeed: data.mapSeed,
      mapName: data.mapName,
    });
    res.status(204).end();
  });

  return router;
}
