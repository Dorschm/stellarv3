// @vitest-environment node

// `src/server/Logger.ts` is transitively imported by jwt.ts via
// OtelResource. It calls `getServerConfigFromServer()` at module-eval
// time, which reads `Env.GAME_ENV`. Under vitest, `import.meta.env.MODE`
// resolves to `"test"`, which is rejected by `getServerConfig()`. Stub
// the logger out before jwt.ts is resolved so the import chain
// short-circuits before it touches the config loader.
import { vi } from "vitest";
vi.mock("../../src/server/Logger", () => {
  const noop = () => {};
  const child = () => ({
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child,
  });
  return {
    logger: { info: noop, warn: noop, error: noop, debug: noop, child },
  };
});

import { SignJWT } from "jose";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { uuidToBase64url } from "../../src/core/Base64";
import { ServerConfig } from "../../src/core/configuration/Config";
import { getApiConfig, resetApiConfig } from "../../src/server/api/config";
import { verifyClientToken } from "../../src/server/jwt";

/**
 * Regression coverage for the user-reported "create lobby instantly closes"
 * symptom on stellar.game.
 *
 * Root cause was a mismatch between the two JWT systems in the codebase:
 *
 *   - `src/server/jwt.ts:verifyClientToken` (used by `create_game`,
 *     `update_game_config`, etc.) was EdDSA-only and pointed at the
 *     upstream auth service's JWKS.
 *   - `src/server/api/jwt.ts:signAccessToken` (used by the self-hosted
 *     Discord OAuth login at `/api/auth/login/discord/callback`) signs
 *     HS256 JWTs with the symmetric `JWT_SECRET`.
 *
 * Logged-in Discord users on stellar.game send the HS256 JWT to
 * `create_game`, the EdDSA verify rejects it, and the lobby modal
 * closes back to the play page with a 401. These tests pin the new
 * fallback path so a future refactor can't silently re-break it.
 */

// PersistentIdSchema is `z.uuid()` which enforces a valid v4 UUID
// (proper version + variant nibbles). Use crypto.randomUUID() so the
// generated UUID is guaranteed to pass that check.
const FAKE_USER_UUID = crypto.randomUUID();
const FAKE_API_BASE_URL = ""; // matches what production uses (same-origin)

function makeStubServerConfig(): ServerConfig {
  // We intentionally make every upstream-auth knob throw — the EdDSA
  // first-attempt path MUST fail so the HS256 fallback is exercised.
  // (Pointing at a real JWKS in tests would require network mocking.)
  return {
    jwtIssuer: () => "https://api.upstream.invalid",
    jwtAudience: () => "upstream",
    jwkPublicKey: async () => {
      throw new Error("JWKS unreachable in this test fixture");
    },
    adminHeader: () => "x-admin-token",
    adminToken: () => "ignored",
  } as unknown as ServerConfig;
}

describe("verifyClientToken — self-hosted HS256 fallback", () => {
  const originalEnv = { ...process.env };
  let secretBytes: Uint8Array;

  beforeEach(() => {
    // Configure the self-hosted backend with a real symmetric secret.
    // Use a fresh 32-byte random secret per test run so we can sign
    // tokens that the real `verifyAccessToken` would also accept.
    const rawSecret = crypto.randomBytes(32).toString("hex");
    process.env.JWT_SECRET = rawSecret;
    process.env.API_BASE_URL = FAKE_API_BASE_URL;
    process.env.DISCORD_CLIENT_ID = "1504196907193466900";
    process.env.DISCORD_CLIENT_SECRET = "any";
    process.env.DISCORD_REDIRECT_URI =
      "https://example.test/api/auth/login/discord/callback";
    resetApiConfig();
    const cfg = getApiConfig();
    if (cfg.jwtSecret === null) throw new Error("test env wiring broken");
    secretBytes = cfg.jwtSecret;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetApiConfig();
  });

  test("accepts a self-hosted HS256 JWT and decodes sub→UUID as persistentId", async () => {
    const sub = uuidToBase64url(FAKE_USER_UUID);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub)
      .setIssuer(FAKE_API_BASE_URL)
      .setAudience("stellar.game")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secretBytes);

    const result = await verifyClientToken(jwt, makeStubServerConfig());

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.persistentId).toBe(FAKE_USER_UUID);
      // claims is null because TokenPayloadSchema requires upstream-shape
      // claims that HS256 self-hosted JWTs don't carry. Downstream gates
      // treat this as "anonymous-but-identified" — same as a bare UUID.
      expect(result.claims).toBeNull();
    }
  });

  test("rejects a self-hosted JWT signed with the wrong secret", async () => {
    const wrongSecret = crypto.randomBytes(32);
    const sub = uuidToBase64url(FAKE_USER_UUID);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub)
      .setIssuer(FAKE_API_BASE_URL)
      .setAudience("stellar.game")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(wrongSecret);

    const result = await verifyClientToken(jwt, makeStubServerConfig());

    expect(result.type).toBe("error");
    if (result.type === "error") {
      // Combined-error message: upstream + self-hosted both failed.
      expect(result.message).toMatch(/self-hosted/);
    }
  });

  test("rejects a self-hosted JWT whose sub doesn't decode to a UUID", async () => {
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("not-a-base64url-uuid-shape!!")
      .setIssuer(FAKE_API_BASE_URL)
      .setAudience("stellar.game")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secretBytes);

    const result = await verifyClientToken(jwt, makeStubServerConfig());
    expect(result.type).toBe("error");
  });

  test("still accepts bare persistent UUIDs", async () => {
    const result = await verifyClientToken(
      FAKE_USER_UUID,
      makeStubServerConfig(),
    );
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.persistentId).toBe(FAKE_USER_UUID);
      expect(result.claims).toBeNull();
    }
  });
});
