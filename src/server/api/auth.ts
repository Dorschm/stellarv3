import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { logger } from "../Logger";
import {
  createSession,
  findActiveSession,
  findUserById,
  revokeAllSessionsForUser,
  revokeSession,
  touchUser,
  upsertDiscordUser,
} from "../userdb";
import { getApiConfig } from "./config";
import { signAccessToken } from "./jwt";

const log = logger.child({ comp: "api-auth" });

/**
 * Cookie name carrying the opaque refresh token. HttpOnly so it can't be
 * read from JS; SameSite=Lax so it follows the OAuth redirect dance back
 * from Discord; Secure in production. The access JWT itself lives only in
 * memory on the client (see `Auth.ts: __jwt`).
 */
const REFRESH_COOKIE_NAME = "openfront_refresh";

/**
 * Cookie set during the OAuth redirect carrying the `state` value plus the
 * client-supplied `redirect_uri`. We use a short-lived cookie rather than
 * a server-side store so the auth handler stays stateless across requests.
 */
const OAUTH_STATE_COOKIE = "openfront_oauth_state";

function buildRefreshCookie(value: string, maxAgeSeconds: number): string {
  const cfg = getApiConfig();
  const parts = [
    `${REFRESH_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (cfg.cookieSecure) parts.push("Secure");
  if (cfg.cookieDomain) parts.push(`Domain=${cfg.cookieDomain}`);
  return parts.join("; ");
}

function clearRefreshCookie(): string {
  const cfg = getApiConfig();
  const parts = [
    `${REFRESH_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (cfg.cookieSecure) parts.push("Secure");
  if (cfg.cookieDomain) parts.push(`Domain=${cfg.cookieDomain}`);
  return parts.join("; ");
}

function buildStateCookie(state: string, redirectUri: string): string {
  const value = Buffer.from(
    JSON.stringify({ state, redirectUri }),
    "utf8",
  ).toString("base64url");
  const cfg = getApiConfig();
  const parts = [
    `${OAUTH_STATE_COOKIE}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=600",
  ];
  if (cfg.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

function clearStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const piece of header.split(";")) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    const k = piece.slice(0, eq).trim();
    const v = piece.slice(eq + 1).trim();
    if (k) out.set(k, decodeURIComponent(v));
  }
  return out;
}

/** Hostname-only "audience" claim used by both signing and verification. */
function deriveAudience(req: Request): string {
  const host = req.hostname || "localhost";
  // Reduce `foo.bar.example.com` to `example.com` to match the client's
  // `getAudience()` implementation.
  const parts = host.split(".");
  return parts.slice(-2).join(".");
}

/** Helper: respond 503 with a clear hint when Discord OAuth isn't configured. */
function requireDiscordConfig(res: Response): boolean {
  const cfg = getApiConfig();
  if (
    !cfg.discordClientId ||
    !cfg.discordClientSecret ||
    !cfg.discordRedirectUri ||
    !cfg.jwtSecret
  ) {
    res.status(503).json({
      error: "discord_oauth_not_configured",
      hint:
        "Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI " +
        "and JWT_SECRET in the server environment.",
    });
    return false;
  }
  return true;
}

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  discriminator: string;
}

async function exchangeDiscordCode(
  code: string,
): Promise<DiscordTokenResponse> {
  const cfg = getApiConfig();
  const body = new URLSearchParams({
    client_id: cfg.discordClientId!,
    client_secret: cfg.discordClientSecret!,
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.discordRedirectUri!,
  });
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Discord token exchange failed: ${res.status}`);
  }
  return (await res.json()) as DiscordTokenResponse;
}

async function fetchDiscordUser(
  accessToken: string,
): Promise<DiscordUserResponse> {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Discord users/@me failed: ${res.status}`);
  }
  return (await res.json()) as DiscordUserResponse;
}

export function createAuthRouter(): Router {
  const router = Router();

  // ── Step 1: kick off OAuth ─────────────────────────────────────────────
  router.get("/login/discord", (req, res) => {
    if (!requireDiscordConfig(res)) return;
    const cfg = getApiConfig();
    const rawRedirect = (req.query.redirect_uri as string | undefined) ?? "/";
    // Only allow same-origin redirect targets so an attacker can't smuggle
    // the user off-site after login.
    const redirectUri =
      typeof rawRedirect === "string" && rawRedirect.startsWith("/")
        ? rawRedirect
        : "/";
    const state = crypto.randomBytes(16).toString("base64url");
    const params = new URLSearchParams({
      client_id: cfg.discordClientId!,
      response_type: "code",
      scope: "identify",
      redirect_uri: cfg.discordRedirectUri!,
      state,
      prompt: "none",
    });
    res.setHeader("Set-Cookie", buildStateCookie(state, redirectUri));
    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
  });

  // ── Step 2: Discord redirects here with ?code & ?state ─────────────────
  router.get("/login/discord/callback", async (req, res) => {
    if (!requireDiscordConfig(res)) return;
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code || !state) {
      res.status(400).send("Missing code or state");
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const stateCookie = cookies.get(OAUTH_STATE_COOKIE);
    if (!stateCookie) {
      res.status(400).send("Missing state cookie");
      return;
    }
    let parsed: { state: string; redirectUri: string };
    try {
      parsed = JSON.parse(
        Buffer.from(stateCookie, "base64url").toString("utf8"),
      );
    } catch {
      res.status(400).send("Malformed state cookie");
      return;
    }
    if (parsed.state !== state) {
      res.status(400).send("State mismatch");
      return;
    }

    try {
      const tokens = await exchangeDiscordCode(code);
      const discordUser = await fetchDiscordUser(tokens.access_token);
      const user = upsertDiscordUser({
        discordId: discordUser.id,
        username: discordUser.username,
        globalName: discordUser.global_name,
        avatar: discordUser.avatar,
        discriminator: discordUser.discriminator,
      });
      const refreshToken = createSession(user.id);
      const refreshLifetimeSec = 30 * 24 * 60 * 60;
      res.setHeader("Set-Cookie", [
        buildRefreshCookie(refreshToken, refreshLifetimeSec),
        clearStateCookie(),
      ]);
      res.redirect(parsed.redirectUri);
    } catch (err) {
      log.error("OAuth callback failed", err);
      res.status(500).send("OAuth callback failed");
    }
  });

  // ── Refresh: trade the refresh cookie for a fresh access JWT ───────────
  router.post("/refresh", async (req, res) => {
    const cfg = getApiConfig();
    if (cfg.jwtSecret === null) {
      res.status(503).json({ error: "jwt_secret_not_configured" });
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = cookies.get(REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      res.status(401).json({ error: "no_refresh_cookie" });
      return;
    }
    const session = findActiveSession(refreshToken);
    if (session === null) {
      res.status(401).json({ error: "invalid_or_expired_session" });
      return;
    }
    const user = findUserById(session.userId);
    if (user === null) {
      res.status(401).json({ error: "user_gone" });
      return;
    }
    touchUser(user.id);
    const audience = deriveAudience(req);
    const { jwt, expiresIn } = await signAccessToken(user.id, audience);
    res.json({ jwt, expiresIn });
  });

  // ── Logout (this session) ──────────────────────────────────────────────
  router.post("/logout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = cookies.get(REFRESH_COOKIE_NAME);
    if (refreshToken) revokeSession(refreshToken);
    res.setHeader("Set-Cookie", clearRefreshCookie());
    res.status(204).end();
  });

  // ── Revoke every session for the current user ──────────────────────────
  router.post("/revoke", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = cookies.get(REFRESH_COOKIE_NAME);
    if (refreshToken) {
      const session = findActiveSession(refreshToken);
      if (session !== null) revokeAllSessionsForUser(session.userId);
    }
    res.setHeader("Set-Cookie", clearRefreshCookie());
    res.status(204).end();
  });

  // ── Magic-link request (stubbed) ───────────────────────────────────────
  // Email login isn't wired up — surface a clear 501 so the client
  // surfaces a "not available" message instead of silently failing.
  router.post("/magic-link", (_req, res) => {
    res.status(501).json({ error: "magic_link_not_implemented" });
  });

  // ── Magic-link callback (stubbed) ──────────────────────────────────────
  router.get("/login/token", (_req, res) => {
    res.status(501).json({ error: "magic_link_not_implemented" });
  });

  return router;
}
