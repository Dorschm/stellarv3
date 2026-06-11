import crypto from "node:crypto";
import { getDb } from "./db";

export interface RunRow {
  id: string;
  userId: string;
  totalTicks: number;
  winCondition: string;
  result: "win" | "loss";
  players: unknown[];
  date: string;
  mapSeed: number | null;
  mapName: string;
  createdAt: number;
}

interface DbRunRow {
  id: string;
  user_id: string;
  total_ticks: number;
  win_condition: string;
  result: string;
  players_json: string;
  date: string;
  map_seed: number | null;
  map_name: string;
  created_at: number;
}

function fromDb(row: DbRunRow): RunRow {
  return {
    id: row.id,
    userId: row.user_id,
    totalTicks: row.total_ticks,
    winCondition: row.win_condition,
    result: row.result === "win" ? "win" : "loss",
    players: JSON.parse(row.players_json),
    date: row.date,
    mapSeed: row.map_seed,
    mapName: row.map_name,
    createdAt: row.created_at,
  };
}

export interface InsertRunInput {
  id?: string;
  userId: string;
  totalTicks: number;
  winCondition: string;
  result: "win" | "loss";
  players: unknown[];
  date: string;
  mapSeed: number | null;
  mapName: string;
}

export function insertRun(input: InsertRunInput): RunRow {
  const id = input.id ?? crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO runs
         (id, user_id, total_ticks, win_condition, result, players_json,
          date, map_seed, map_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId,
      input.totalTicks,
      input.winCondition,
      input.result,
      JSON.stringify(input.players),
      input.date,
      input.mapSeed,
      input.mapName,
      now,
    );
  return fromDb(
    getDb().prepare("SELECT * FROM runs WHERE id = ?").get(id) as DbRunRow,
  );
}

/** List a user's runs newest-first. Capped at 200 — the run-history UI
 * paginates, but a hard ceiling here keeps payloads bounded. */
export function listRunsForUser(userId: string, limit = 200): RunRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM runs
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as DbRunRow[];
  return rows.map(fromDb);
}
