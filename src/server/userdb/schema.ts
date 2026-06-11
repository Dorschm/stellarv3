/**
 * SQLite schema for the self-hosted user database. Applied idempotently on
 * server boot via {@link applySchema} — every statement is `CREATE … IF NOT
 * EXISTS` so the same migration text can run unmodified against a fresh DB
 * or an already-bootstrapped one.
 *
 * The schema deliberately covers only what the existing client API surface
 * needs (users, refresh sessions, run history). Cosmetics inventory and
 * leaderboards are intentionally absent — the stub endpoints serve empty
 * payloads, and a future migration can add the tables when those features
 * grow real implementations.
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  discord_id TEXT UNIQUE,
  discord_username TEXT,
  discord_global_name TEXT,
  discord_avatar TEXT,
  discord_discriminator TEXT,
  email TEXT,
  public_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);

CREATE TABLE IF NOT EXISTS sessions (
  refresh_token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  total_ticks INTEGER NOT NULL,
  win_condition TEXT NOT NULL,
  result TEXT NOT NULL,
  players_json TEXT NOT NULL,
  date TEXT NOT NULL,
  map_seed INTEGER,
  map_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_user_id_created
  ON runs(user_id, created_at DESC);
`;

export function applySchema(db: { exec(sql: string): unknown }): void {
  db.exec(SCHEMA_SQL);
}
