import { jwtVerify } from "jose";
import { z } from "zod";
import {
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { base64urlToUuid } from "../core/Base64";
import { ServerConfig } from "../core/configuration/Config";
import { PersistentIdSchema } from "../core/Schemas";
import { getApiConfig } from "./api/config";

type TokenVerificationResult =
  | {
      type: "success";
      persistentId: string;
      claims: TokenPayload | null;
    }
  | { type: "error"; message: string };

export async function verifyClientToken(
  token: string,
  config: ServerConfig,
): Promise<TokenVerificationResult> {
  if (PersistentIdSchema.safeParse(token).success) {
    // Accept bare persistent IDs in all environments. stellar.game runs
    // without the external auth service (api.${jwtAudience}) that issues
    // JWTs, so anonymous play would be impossible in Prod otherwise.
    // Worker.ts still gates privileged behavior on `claims`, and Turnstile
    // still gates bot protection on join.
    return { type: "success", persistentId: token, claims: null };
  }

  // ── First attempt: external EdDSA-signed JWTs (upstream auth service)
  // The original OpenFront upstream runs an `api.${jwtAudience}` service
  // that mints EdDSA-signed JWTs validated via JWKS. stellar.game does not
  // run this service, so this branch will only succeed when configured
  // against the upstream — kept as the first-tier path so deployments
  // pointed at the upstream behave as before.
  let upstreamErr: string | null = null;
  try {
    const issuer = config.jwtIssuer();
    const audience = config.jwtAudience();
    const key = await config.jwkPublicKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer,
      audience,
    });
    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      return {
        type: "error",
        message: z.prettifyError(result.error),
      };
    }
    const claims = result.data;
    const persistentId = claims.sub;
    return { type: "success", persistentId, claims };
  } catch (e) {
    upstreamErr =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "unknown upstream-auth verify error";
  }

  // ── Second attempt: self-hosted Discord OAuth HS256 JWTs ──────────────
  // src/server/api/auth.ts mints these on `/api/auth/login/discord/callback`
  // when `DISCORD_CLIENT_ID` + `JWT_SECRET` are configured (stellar.game's
  // setup). The upstream verifier above doesn't recognize HS256 because
  // it expects EdDSA + JWKS, so without this fallback any logged-in
  // Discord user would get rejected by `/api/create_game` (and any other
  // endpoint that calls `verifyClientToken`) and the lobby modal would
  // close instantly with "Invalid creator token" 401.
  //
  // The `sub` claim is `uuidToBase64url(userId)`; we decode it back to a
  // canonical UUID so the rest of the server (which keys creators and
  // sessions on persistent UUIDs) is comparing apples to apples.
  const apiCfg = getApiConfig();
  if (apiCfg.jwtSecret !== null) {
    try {
      const { payload } = await jwtVerify(token, apiCfg.jwtSecret, {
        issuer: apiCfg.apiBaseUrl,
      });
      const subRaw = payload.sub;
      if (typeof subRaw !== "string" || subRaw.length === 0) {
        return {
          type: "error",
          message: "self-hosted JWT missing sub claim",
        };
      }
      // Decode base64url(uuid) → canonical UUID. If this throws (token
      // wasn't minted by signAccessToken), fall through to the error
      // below so the operator sees both branches' diagnostics.
      const persistentId = base64urlToUuid(subRaw);
      // Re-validate the decoded UUID looks legit before handing it back
      // to the rest of the system.
      if (!PersistentIdSchema.safeParse(persistentId).success) {
        return {
          type: "error",
          message: `self-hosted JWT sub did not decode to a valid UUID: ${subRaw}`,
        };
      }
      // claims is null because TokenPayloadSchema requires upstream-shape
      // claims (iss/aud match jwtAudience + extra fields). The downstream
      // gates on `claims !== null` will treat this user as anonymous-but-
      // identified, same as a bare persistent UUID submission.
      return { type: "success", persistentId, claims: null };
    } catch (e) {
      const selfHostedErr =
        e instanceof Error ? e.message : "unknown self-hosted JWT verify error";
      return {
        type: "error",
        message: `upstream(${upstreamErr}); self-hosted(${selfHostedErr})`,
      };
    }
  }

  return { type: "error", message: upstreamErr };
}

export async function getUserMe(
  token: string,
  config: ServerConfig,
): Promise<
  | { type: "success"; response: UserMeResponse }
  | { type: "error"; message: string }
> {
  try {
    // Get the user object
    const response = await fetch(config.jwtIssuer() + "/users/@me", {
      headers: {
        authorization: `Bearer ${token}`,
        "x-api-key": config.apiKey(),
      },
    });
    if (response.status !== 200) {
      return {
        type: "error",
        message: `Failed to fetch user me: ${response.statusText}`,
      };
    }
    const body = await response.json();
    const result = UserMeResponseSchema.safeParse(body);
    if (!result.success) {
      return {
        type: "error",
        message: `Invalid response: ${z.prettifyError(result.error)}`,
      };
    }
    return { type: "success", response: result.data };
  } catch (e) {
    return {
      type: "error",
      message: `Failed to fetch user me: ${e}`,
    };
  }
}
