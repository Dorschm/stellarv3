import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../Logger";
import { applySchema } from "./schema";

const log = logger.child({ comp: "userdb" });

let _db: Database.Database | null = null;

/**
 * Resolve the SQLite database file path.
 *
 * Reads `USERDB_PATH` from the environment when set — otherwise falls back
 * to `./data/userdb.sqlite` under the project root. The parent directory is
 * created automatically on first boot.
 *
 * Pass `":memory:"` (via `USERDB_PATH=:memory:`) to use a transient
 * in-memory database — handy for tests and for short-lived ephemeral
 * deployments that don't need persistence.
 */
function resolveDbPath(): string {
  const override = process.env.USERDB_PATH;
  if (override && override.length > 0) {
    return override;
  }
  return path.resolve(process.cwd(), "data", "userdb.sqlite");
}

/**
 * Open (or reuse) the singleton SQLite handle. Idempotent — every call
 * returns the same instance. The schema is applied once on first open.
 */
export function getDb(): Database.Database {
  if (_db !== null) return _db;
  const dbPath = resolveDbPath();
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  applySchema(db);
  _db = db;
  log.info(`userdb ready at ${dbPath}`);
  return db;
}

/** Close the singleton handle. Used by tests to reset between cases. */
export function closeDb(): void {
  if (_db === null) return;
  _db.close();
  _db = null;
}
