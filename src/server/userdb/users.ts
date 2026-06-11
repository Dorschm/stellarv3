import crypto from "node:crypto";
import { getDb } from "./db";

export interface UserRow {
  id: string;
  discordId: string | null;
  discordUsername: string | null;
  discordGlobalName: string | null;
  discordAvatar: string | null;
  discordDiscriminator: string | null;
  email: string | null;
  publicId: string;
  createdAt: number;
  lastSeenAt: number;
}

interface DbUserRow {
  id: string;
  discord_id: string | null;
  discord_username: string | null;
  discord_global_name: string | null;
  discord_avatar: string | null;
  discord_discriminator: string | null;
  email: string | null;
  public_id: string;
  created_at: number;
  last_seen_at: number;
}

function fromDb(row: DbUserRow): UserRow {
  return {
    id: row.id,
    discordId: row.discord_id,
    discordUsername: row.discord_username,
    discordGlobalName: row.discord_global_name,
    discordAvatar: row.discord_avatar,
    discordDiscriminator: row.discord_discriminator,
    email: row.email,
    publicId: row.public_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** Generate a short public-facing id. Eight base32 chars ≈ 40 bits of entropy
 * — collision-resistant at the scale of any self-hosted deployment.
 */
function generatePublicId(): string {
  return crypto.randomBytes(5).toString("base64url").slice(0, 8);
}

export function findUserById(id: string): UserRow | null {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | DbUserRow
    | undefined;
  return row ? fromDb(row) : null;
}

export function findUserByDiscordId(discordId: string): UserRow | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE discord_id = ?")
    .get(discordId) as DbUserRow | undefined;
  return row ? fromDb(row) : null;
}

export function findUserByPublicId(publicId: string): UserRow | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE public_id = ?")
    .get(publicId) as DbUserRow | undefined;
  return row ? fromDb(row) : null;
}

export interface UpsertDiscordUserInput {
  discordId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  discriminator: string;
}

/**
 * Create-or-update a user keyed on `discordId`. Returns the persisted row.
 *
 * The `id` (internal UUID, becomes the JWT `sub`) and `publicId` are
 * generated on first insert and never change. Subsequent OAuth logins
 * refresh the cached Discord profile fields and bump `last_seen_at`.
 */
export function upsertDiscordUser(input: UpsertDiscordUserInput): UserRow {
  const db = getDb();
  const now = Date.now();
  const existing = findUserByDiscordId(input.discordId);
  if (existing !== null) {
    db.prepare(
      `UPDATE users
       SET discord_username = ?, discord_global_name = ?,
           discord_avatar = ?, discord_discriminator = ?,
           last_seen_at = ?
       WHERE id = ?`,
    ).run(
      input.username,
      input.globalName,
      input.avatar,
      input.discriminator,
      now,
      existing.id,
    );
    return findUserById(existing.id)!;
  }
  const id = crypto.randomUUID();
  let publicId = generatePublicId();
  // Defensive: regenerate publicId on the off chance of a collision.
  while (findUserByPublicId(publicId) !== null) {
    publicId = generatePublicId();
  }
  db.prepare(
    `INSERT INTO users
       (id, discord_id, discord_username, discord_global_name,
        discord_avatar, discord_discriminator, email, public_id,
        created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    input.discordId,
    input.username,
    input.globalName,
    input.avatar,
    input.discriminator,
    publicId,
    now,
    now,
  );
  return findUserById(id)!;
}

/** Touch `last_seen_at` to now. Cheap; called on every token refresh. */
export function touchUser(id: string): void {
  getDb()
    .prepare("UPDATE users SET last_seen_at = ? WHERE id = ?")
    .run(Date.now(), id);
}
