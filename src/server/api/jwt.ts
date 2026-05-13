import crypto from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { uuidToBase64url } from "../../core/Base64";
import { getApiConfig } from "./config";

export interface AccessTokenClaims {
  /** Internal user id, encoded base64url to satisfy `TokenPayloadSchema`. */
  sub: string;
  jti: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

/**
 * Sign an access token for `userId`. Returns the compact JWT string and the
 * `expiresIn` seconds the client should use to schedule refresh.
 *
 * `userId` is a canonical UUID. We base64url-encode it for the `sub` claim
 * to match the client-side `TokenPayloadSchema` which decodes `sub` back
 * into a UUID via {@link base64urlToUuid}.
 */
export async function signAccessToken(
  userId: string,
  audience: string,
): Promise<{ jwt: string; expiresIn: number }> {
  const cfg = getApiConfig();
  if (cfg.jwtSecret === null) {
    throw new Error("JWT_SECRET is not configured");
  }
  const sub = uuidToBase64url(userId);
  const jti = crypto.randomBytes(16).toString("base64url");
  const expiresIn = cfg.accessTokenTtlSeconds;
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setJti(jti)
    .setIssuer(cfg.apiBaseUrl)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(cfg.jwtSecret);
  return { jwt, expiresIn };
}

/**
 * Verify a bearer JWT and return the decoded claims. Throws on any failure
 * — caller is expected to catch and return 401.
 */
export async function verifyAccessToken(
  jwt: string,
): Promise<AccessTokenClaims> {
  const cfg = getApiConfig();
  if (cfg.jwtSecret === null) {
    throw new Error("JWT_SECRET is not configured");
  }
  const { payload } = await jwtVerify(jwt, cfg.jwtSecret, {
    issuer: cfg.apiBaseUrl,
  });
  return payload as AccessTokenClaims;
}
