import { decodeJwt } from "jose";
import { UserSettings } from "src/core/game/UserSettings";
import { z } from "zod";
import { TokenPayload, TokenPayloadSchema } from "../core/ApiSchemas";
import { base64urlToUuid } from "../core/Base64";
import { getApiBase, getAudience } from "./Api";
import { generateCryptoRandomUUID } from "./Utils";

export type UserAuth = { jwt: string; claims: TokenPayload } | false;

const PERSISTENT_ID_KEY = "player_persistent_id";

let __jwt: string | null = null;
let __refreshPromise: Promise<void> | null = null;
let __expiresAt: number = 0;

// Deployments that don't run the upstream auth service (`api.${domain}`)
// would otherwise log two red `TypeError: Failed to fetch` errors on every
// page load — once on boot-time refresh and once per WS `joinGame`. The
// flow still works because the client falls back to a persistent UUID
// which the server accepts on its own (see jwt.ts persistent-ID path), so
// those errors are expected noise rather than real failures. The first
// network-level `fetch` failure against api.${domain} flips this flag and
// short-circuits every subsequent `getApiBase()` call with a silent
// `false` — avoiding repeat DNS lookups and keeping the console clean.
// Re-set to `false` if you stand up a real auth service and reload; a
// 4xx/5xx from a reachable auth service does NOT flip this (different
// code path), so recoverable backend errors still surface.
let __upstreamAuthUnreachable = false;

export function discordLogin() {
  // Send only the path + search/hash so the server-side same-origin check
  // accepts it; the server prefixes its own origin when redirecting back.
  const here = window.location;
  const postLogin = `${here.pathname}${here.search}${here.hash}` || "/";
  const redirectUri = encodeURIComponent(postLogin);
  window.location.href = `${getApiBase()}/api/auth/login/discord?redirect_uri=${redirectUri}`;
}

export async function tempTokenLogin(token: string): Promise<string | null> {
  const response = await fetch(
    `${getApiBase()}/api/auth/login/token?login-token=${token}`,
    {
      credentials: "include",
    },
  );
  if (response.status !== 200) {
    console.error("Token login failed", response);
    return null;
  }
  const json = await response.json();
  const { email } = json;
  return email;
}

export async function getAuthHeader(): Promise<string> {
  const userAuthResult = await userAuth();
  if (!userAuthResult) return "";
  const { jwt } = userAuthResult;
  return `Bearer ${jwt}`;
}

export async function logOut(allSessions: boolean = false): Promise<boolean> {
  try {
    const response = await fetch(
      getApiBase() + (allSessions ? "/api/auth/revoke" : "/api/auth/logout"),
      {
        method: "POST",
        credentials: "include",
      },
    );

    if (response.ok === false) {
      console.error("Logout failed", response);
      return false;
    }

    return true;
  } catch (e) {
    console.error("Logout failed", e);
    return false;
  } finally {
    __jwt = null;
    localStorage.removeItem(PERSISTENT_ID_KEY);
    new UserSettings().clearFlag();
    new UserSettings().setSelectedPatternName(undefined);
  }
}

export async function isLoggedIn(): Promise<boolean> {
  const userAuthResult = await userAuth();
  return userAuthResult !== false;
}

export async function userAuth(
  shouldRefresh: boolean = true,
): Promise<UserAuth> {
  try {
    const jwt = __jwt;
    if (!jwt) {
      if (!shouldRefresh) {
        // Expected when upstream auth isn't deployed — the caller gets
        // `false` and falls back to the persistent-ID path. Downgraded
        // from warn to avoid noisy console output on every join.
        return false;
      }
      // Skip the refresh attempt entirely if the upstream auth API has
      // already been observed unreachable this session. Saves a DNS
      // lookup + TypeError + red log line per call.
      if (__upstreamAuthUnreachable) {
        return false;
      }
      await refreshJwt();
      return userAuth(false);
    }

    // Verify the JWT (requires browser support)
    // const jwks = createRemoteJWKSet(
    //   new URL(getApiBase() + "/.well-known/jwks.json"),
    // );
    // const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    //   issuer: getApiBase(),
    //   audience: getAudience(),
    // });

    const payload = decodeJwt(jwt);
    const { iss, aud } = payload;

    // `iss` must match the server's `API_BASE_URL` env var (defaults to
    // empty string ⇒ same-origin). The client's `getApiBase()` follows the
    // same defaulting rule, so a bare deployment matches `iss === ""` and a
    // split-domain deployment matches `iss === "https://api.example.com"`.
    if (iss !== getApiBase()) {
      // JWT was not issued by the correct server
      console.error('unexpected "iss" claim value');
      logOut();
      return false;
    }
    const myAud = getAudience();
    if (myAud !== "localhost" && aud !== myAud) {
      // JWT was not issued for this website
      console.error('unexpected "aud" claim value');
      logOut();
      return false;
    }
    if (Date.now() >= __expiresAt - 3 * 60 * 1000) {
      console.log("jwt expired or about to expire");
      if (!shouldRefresh) {
        console.error("jwt expired and shouldRefresh is false");
        return false;
      }
      await refreshJwt();

      // Try to get login info again after refreshing
      return userAuth(false);
    }

    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid payload", error);
      return false;
    }

    const claims = result.data;
    return { jwt, claims };
  } catch (e) {
    console.error("isLoggedIn failed", e);
    return false;
  }
}

async function refreshJwt(): Promise<void> {
  if (__refreshPromise) {
    return __refreshPromise;
  }
  __refreshPromise = doRefreshJwt();
  try {
    await __refreshPromise;
  } finally {
    __refreshPromise = null;
  }
}

async function doRefreshJwt(): Promise<void> {
  try {
    const response = await fetch(getApiBase() + "/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (response.status !== 200) {
      // Real HTTP failure from a reachable auth service: keep the error
      // log so real deployments can diagnose backend problems. Do NOT
      // call logOut() here — that clears `player_persistent_id` from
      // localStorage, so a brand-new anonymous UUID is generated on every
      // subsequent `getPlayToken()` call. The self-hosted backend (see
      // src/server/api/auth.ts) returns 401 (no refresh cookie) or 503
      // (no JWT secret configured) for anonymous sessions, which would
      // otherwise re-roll the persistent ID on every refresh attempt
      // and break creator-only flows (start_game, cancel_game) whose
      // server-side check compares the create-time persistent ID against
      // the start-time one.
      if (response.status !== 401) {
        console.error("Refresh failed", response);
      }
      __jwt = null;
      return;
    }
    const json = await response.json();
    const { jwt, expiresIn } = json;
    __expiresAt = Date.now() + expiresIn * 1000;
    __jwt = jwt;
  } catch (e) {
    // TypeError ("Failed to fetch" / DNS failure / CORS) means the
    // upstream auth service isn't deployed at this domain. This is the
    // expected state on deployments that only run the game server (e.g.
    // stellar.game) — anonymous persistent-ID auth covers the join path.
    // Remember it so we don't retry every page nav / join attempt, and
    // only log it once at info level instead of spamming the console.
    if (e instanceof TypeError && !__upstreamAuthUnreachable) {
      __upstreamAuthUnreachable = true;
      console.info(
        `Upstream auth service at ${getApiBase()} is unreachable; ` +
          "running in anonymous persistent-ID mode",
      );
    }
    __jwt = null;
    return;
  }
}

export async function sendMagicLink(email: string): Promise<boolean> {
  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/api/auth/magic-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        redirectDomain: window.location.origin,
        email: email,
      }),
    });

    if (response.ok) {
      return true;
    } else {
      console.error(
        "Failed to send recovery email:",
        response.status,
        response.statusText,
      );
      return false;
    }
  } catch (error) {
    console.error("Error sending recovery email:", error);
    return false;
  }
}

// WARNING: DO NOT EXPOSE THIS ID
export async function getPlayToken(): Promise<string> {
  const result = await userAuth();
  if (result !== false) return result.jwt;
  return getPersistentIDFromLocalStorage();
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentID(): string {
  const jwt = __jwt;
  if (!jwt) return getPersistentIDFromLocalStorage();
  const payload = decodeJwt(jwt);
  const sub = payload.sub;
  if (!sub) return getPersistentIDFromLocalStorage();
  return base64urlToUuid(sub);
}

// WARNING: DO NOT EXPOSE THIS ID
function getPersistentIDFromLocalStorage(): string {
  // Try to get existing localStorage
  const value = localStorage.getItem(PERSISTENT_ID_KEY);
  if (value) return value;

  // If no localStorage exists, create new ID and set localStorage
  const newID = generateCryptoRandomUUID();
  localStorage.setItem(PERSISTENT_ID_KEY, newID);

  return newID;
}
