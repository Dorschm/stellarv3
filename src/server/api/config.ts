import { logger } from "../Logger";

const log = logger.child({ comp: "api-config" });

/**
 * Resolved API configuration drawn from environment variables.
 *
 * Required (server will refuse to expose auth endpoints if missing):
 *   DISCORD_CLIENT_ID       — from discord.com/developers application
 *   DISCORD_CLIENT_SECRET   — same place
 *   DISCORD_REDIRECT_URI    — must match the OAuth redirect URI registered
 *                             with Discord. Typically `${API_BASE_URL}/api/auth/login/discord/callback`.
 *   JWT_SECRET              — HS256 signing secret, ≥32 random bytes.
 *
 * Optional:
 *   API_BASE_URL            — issuer claim on minted JWTs and the absolute
 *                             prefix the client uses to verify `iss`.
 *                             Defaults to `""` (same-origin), which matches
 *                             the client-side `getApiBase()` default.
 *   ACCESS_TOKEN_TTL_SEC    — seconds before an access token expires.
 *                             Default 900 (15 min); refresh covers the gap.
 *   COOKIE_DOMAIN           — `Domain=` attribute on the refresh cookie.
 *                             Default unset (host-only cookie).
 *   COOKIE_SECURE           — "false" to disable Secure flag for HTTP dev.
 *                             Defaults to true in prod, false in dev.
 */
export interface ApiConfig {
  discordClientId: string | null;
  discordClientSecret: string | null;
  discordRedirectUri: string | null;
  jwtSecret: Uint8Array | null;
  apiBaseUrl: string;
  accessTokenTtlSeconds: number;
  cookieDomain: string | undefined;
  cookieSecure: boolean;
}

let _cached: ApiConfig | null = null;

export function getApiConfig(): ApiConfig {
  if (_cached !== null) return _cached;

  const discordClientId = process.env.DISCORD_CLIENT_ID ?? null;
  const discordClientSecret = process.env.DISCORD_CLIENT_SECRET ?? null;
  const discordRedirectUri = process.env.DISCORD_REDIRECT_URI ?? null;
  const jwtSecretRaw = process.env.JWT_SECRET;
  const jwtSecret = jwtSecretRaw
    ? new TextEncoder().encode(jwtSecretRaw)
    : null;

  if (jwtSecret !== null && jwtSecret.byteLength < 32) {
    log.warn(
      `JWT_SECRET is shorter than 32 bytes (${jwtSecret.byteLength}); ` +
        "this weakens HS256 signing. Use a longer random secret in production.",
    );
  }
  if (!jwtSecret) {
    log.warn(
      "JWT_SECRET is unset — Discord OAuth endpoints will reject all " +
        "requests until it is configured.",
    );
  }
  if (!discordClientId || !discordClientSecret || !discordRedirectUri) {
    log.warn(
      "Discord OAuth env vars are missing (DISCORD_CLIENT_ID, " +
        "DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI). The /api/auth/login/" +
        "discord endpoint will return 503 until they are set.",
    );
  }

  const apiBaseUrl = process.env.API_BASE_URL ?? "";
  const accessTokenTtlSeconds = Number.parseInt(
    process.env.ACCESS_TOKEN_TTL_SEC ?? "900",
    10,
  );
  const cookieDomain = process.env.COOKIE_DOMAIN;
  const cookieSecure = (() => {
    const raw = process.env.COOKIE_SECURE;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return process.env.NODE_ENV === "production";
  })();

  _cached = {
    discordClientId,
    discordClientSecret,
    discordRedirectUri,
    jwtSecret,
    apiBaseUrl,
    accessTokenTtlSeconds,
    cookieDomain,
    cookieSecure,
  };
  return _cached;
}

/** Force a re-read of env on next call. Tests only. */
export function resetApiConfig(): void {
  _cached = null;
}
