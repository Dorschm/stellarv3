import { Router } from "express";
import {
  findUserById,
  findUserByPublicId,
  type UserRow,
} from "../userdb";
import { requireAuthUser } from "./authMiddleware";

function discordPayload(user: UserRow) {
  if (!user.discordId) return undefined;
  return {
    id: user.discordId,
    avatar: user.discordAvatar,
    username: user.discordUsername ?? "",
    global_name: user.discordGlobalName,
    discriminator: user.discordDiscriminator ?? "0",
  };
}

export function createUsersRouter(): Router {
  const router = Router();

  // GET /users/@me — current user's profile + achievements + leaderboard
  router.get("/@me", requireAuthUser, (req, res) => {
    const user = req.authUser!;
    res.json({
      user: {
        discord: discordPayload(user),
        email: user.email ?? undefined,
      },
      player: {
        publicId: user.publicId,
        roles: [],
        flares: [],
        achievements: {
          singleplayerMap: [],
        },
        leaderboard: {},
      },
    });
  });

  return router;
}

export function createPlayerRouter(): Router {
  const router = Router();

  // GET /player/:publicId — public profile lookup
  router.get("/:publicId", requireAuthUser, (req, res) => {
    const publicId = String(req.params.publicId ?? "");
    const lookup = findUserByPublicId(publicId);
    if (lookup === null) {
      res.status(404).json({ error: "player_not_found" });
      return;
    }
    void findUserById; // referenced for tree-shake safety; intentional.
    res.json({
      createdAt: new Date(lookup.createdAt).toISOString(),
      user: discordPayload(lookup),
      games: [],
      stats: {},
    });
  });

  return router;
}
