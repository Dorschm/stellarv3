import type { NextFunction, Request, Response } from "express";
import { base64urlToUuid } from "../../core/Base64";
import { findUserById, type UserRow } from "../userdb";
import { verifyAccessToken } from "./jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: UserRow;
    }
  }
}

/**
 * Express middleware that validates a `Authorization: Bearer …` JWT, looks
 * up the matching user row, and attaches it to `req.authUser`. Responds
 * with 401 on any failure — handlers downstream can rely on `req.authUser`
 * being present.
 */
export async function requireAuthUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing_bearer_token" });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "empty_bearer_token" });
    return;
  }
  try {
    const claims = await verifyAccessToken(token);
    const userId = base64urlToUuid(claims.sub);
    const user = findUserById(userId);
    if (user === null) {
      res.status(401).json({ error: "user_not_found" });
      return;
    }
    req.authUser = user;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}
