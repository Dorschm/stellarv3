import crypto from "node:crypto";
import { getDb } from "./db";

export interface SessionRow {
  refreshToken: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
}

interface DbSessionRow {
  refresh_token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  revoked: number;
}

function fromDb(row: DbSessionRow): SessionRow {
  return {
    refreshToken: row.refresh_token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revoked: row.revoked === 1,
  };
}

/** Refresh-token lifetime — 30 days. Tuned long so casual players don't get
 * silently logged out, but short enough to bound the blast radius of a
 * stolen cookie. */
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Mint a fresh opaque refresh token for `userId`, persist it, and return
 * the token string. The caller is responsible for putting the value into an
 * HttpOnly cookie on the response.
 */
export function createSession(userId: string): string {
  const refreshToken = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO sessions
         (refresh_token, user_id, created_at, expires_at, revoked)
       VALUES (?, ?, ?, ?, 0)`,
    )
    .run(refreshToken, userId, now, now + REFRESH_TOKEN_LIFETIME_MS);
  return refreshToken;
}

/** Look up an active (non-revoked, non-expired) session by token. */
export function findActiveSession(refreshToken: string): SessionRow | null {
  const row = getDb()
    .prepare("SELECT * FROM sessions WHERE refresh_token = ?")
    .get(refreshToken) as DbSessionRow | undefined;
  if (!row) return null;
  const session = fromDb(row);
  if (session.revoked) return null;
  if (session.expiresAt <= Date.now()) return null;
  return session;
}

export function revokeSession(refreshToken: string): void {
  getDb()
    .prepare("UPDATE sessions SET revoked = 1 WHERE refresh_token = ?")
    .run(refreshToken);
}

/** Revoke every active session for a user — used by `POST /auth/revoke`. */
export function revokeAllSessionsForUser(userId: string): void {
  getDb()
    .prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?")
    .run(userId);
}
