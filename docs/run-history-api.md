# Run History API — External Server Contract

The OpenFront client persists per-account "run history" (past game results shown on the
**Legacy** screen) via two endpoints on the auth server at `config.jwtIssuer()` — the same
origin that serves `/users/@me`, `/auth/refresh`, etc.

Until these endpoints exist, the client falls back to localStorage-only behavior. Nothing
breaks when the server returns 404 on these paths.

## Auth

Bearer JWT in `Authorization` header, identical to `/users/@me`. The user is identified by
the `sub` claim (base64-encoded UUID). All reads/writes are scoped to that user.

## Endpoints

### `GET /users/@me/runs`

Returns the authenticated user's saved runs.

**Response 200:**

```json
{
  "runs": [
    {
      "id": "9fbe0f2e-5b0e-4f3a-b1e4-8c8c4f6a93f1",
      "totalTicks": 3421,
      "winCondition": "elimination",
      "players": [
        {
          "clientID": "c_abc",
          "playerID": "p_xyz",
          "name": "Player 1",
          "planetsConquered": 4,
          "systemsControlled": 2,
          "survivalTicks": 3421,
          "eliminationRank": 1
        }
      ],
      "date": "2026-04-12T18:23:05.000Z",
      "mapSeed": null,
      "mapName": "Sol System",
      "result": "win"
    }
  ]
}
```

**Response 404:** Treated as "no runs yet" (empty list). Safe default before the feature is deployed.

### `POST /users/@me/runs`

Appends one completed run. Body is a single `PersistedRunScore` object (shape as above).

**Idempotency:** The client generates a stable `id` (UUIDv4) per run. If the server receives
a POST with an `id` already present for this user, it MUST return 2xx without creating a
duplicate. Missing `id` is allowed (legacy entries from older clients) — in that case the
server may generate one.

**Response:** Any 2xx status. Body is ignored by the client.

## Storage / retention

- The client caps its local copy at 100 entries. The server may cap similarly or higher; the
  client handles receiving more without issue.
- Entries are immutable. There is no PUT/DELETE/PATCH.
- Ordering: the client sorts by `date` ascending on read. The server does not need to guarantee
  order.

## Zod schema (canonical)

See `src/core/ApiSchemas.ts`:

- `PersistedRunScoreSchema` — one run
- `RunHistoryResponseSchema` — `{ runs: PersistedRunScoreSchema[] }`

Both are exported so the server implementation can share validation if it's in TypeScript.

## Client sync behavior

On login (`userMeResponse` fires with a non-false response):

1. `GET /users/@me/runs`
2. Merge server list with local cache, deduping by `id` (fallback key: `date|mapName|totalTicks`)
3. Write merged list to localStorage
4. For each local-only entry, `POST /users/@me/runs` (backfill)

After each game ends (`WinModal`):

1. `saveRunScore()` writes to localStorage (always — works offline/logged-out)
2. If logged in, fire-and-forget `POST /users/@me/runs`

If `POST` fails, the entry stays in localStorage and is retried on next login via the
backfill step above.
