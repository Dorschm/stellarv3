# OpenFront — CLAUDE.md

> Space-themed real-time strategy game. Formerly planet-themed; renaming is in progress — expect
> legacy strings that still say "planet", "island", "ocean", etc.

---

## 1. Project Overview

**What it is:** A browser-based multiplayer RTS where players expand territory across procedurally
generated or hand-crafted space maps. Players conquer tiles, build structures, launch weapons, and
form alliances.

**Architecture:**

```
Browser (React + Pixi.js + Three.js)
    ↕ WebSocket (Intents → Turns)
Node.js Server  ─ Master process (HTTP, lobby)
                ─ Worker processes (one per active game)
```

**Deterministic simulation:** Game logic runs identically on server and client. The server is
authoritative; the client runs a local copy for smooth rendering. Every Execution must be
deterministic — no `Math.random()`, only `PseudoRandom` seeded from the game ID.

**Tick loop:** `GameImpl.executeNextTick()` runs each tick. On each tick the server broadcasts a
`Turn` (list of `StampedIntent`s). The `Executor` converts each intent into an `Execution` instance
and calls `init()` once, then `tick()` every subsequent tick until `isActive()` returns false.

**Data flow:**

```
Client click → Transport.sendIntent() → WebSocket → GameServer → Turn queue
→ Turn broadcast → Client & Server both run Executor.createExec(intent)
→ Execution.init(game, tick) + Execution.tick(tick) each game tick
```

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.7 (ES2020 target, ESNext modules) |
| Client framework | React 19 |
| 2D rendering | Pixi.js 8 (tile map, units) |
| 3D rendering | Three.js 0.174 + @react-three/fiber (space scene, planets) |
| State management | Zustand 5 |
| Server framework | Express 5 + `ws` WebSockets |
| Schema validation | Zod 4 |
| Build tool | Vite 7 |
| Unit tests | Vitest 4 |
| E2E tests | Playwright |
| Map generator | Go (in `map-generator/`) |
| Logging | Winston + OpenTelemetry |
| Styling | Tailwind CSS 4 |
| Audio | Howler.js |
| Binary protocol | protobufjs |

---

## 3. Folder Structure

```
.
├── src/
│   ├── client/          React UI, Pixi/Three rendering, input, sound
│   ├── core/            Deterministic game simulation (shared client+server)
│   └── server/          Node.js HTTP/WebSocket server (master + workers)
├── tests/               Vitest unit/integration tests + Playwright E2E
│   ├── util/            Setup helpers (Setup.ts, TestConfig, utils)
│   ├── testdata/maps/   Binary map files for tests (6 maps)
│   ├── e2e/             Playwright specs + fixtures/
│   ├── core/            Tests mirroring src/core/ structure
│   ├── economy/         Economy formula tests
│   ├── nukes/           Nuke/warhead tests
│   ├── integration/     GameView integration tests
│   └── pathfinding/     Benchmarks + playground server
├── map-generator/       Go CLI: PNG → binary map data
├── resources/           Static assets
│   ├── lang/            39 locale JSON files (en.json is canonical)
│   ├── maps/            Production binary maps (60+ maps)
│   ├── sprites/         Game sprites
│   ├── sounds/          Audio assets
│   ├── flags/           Country flag SVGs
│   └── QuickChat.json   Quick-chat message keys
├── scripts/             Build/utility scripts (generate-space-maps.mjs)
├── generated/           Auto-generated files (do not edit manually)
├── proprietary/         Licensed assets not open-sourced
└── .claude/             Claude Code config (worktrees/, settings)
```

### `src/core/` subfolders

```
src/core/
├── configuration/       Config.ts interface + DefaultConfig, Dev/Prod/Preprod overrides
├── execution/           One file per Execution class + ExecutionManager (Executor)
│   ├── alliance/        Alliance-specific executions (Request, Reject, Extension, Break)
│   ├── nation/          Nation AI executions
│   └── utils/           FlatBinaryHeap, PlayerSpawner, TribeSpawner
├── game/                Core game types and state
│   ├── Game.ts          All major interfaces + enums (UnitType, TerrainType, Execution, etc.)
│   ├── GameImpl.ts      createGame() + GameImpl class
│   ├── GameMap.ts       GameMap interface + TileRef type
│   ├── GameMapImpl.ts   Bit-encoded tile storage
│   ├── SectorMap.ts     Sector/hyperspace lane topology
│   ├── HyperspaceLaneNetwork.ts  Lane graph
│   ├── Planet.ts        Planet metadata (name, position, radius)
│   └── Stats.ts         Per-player statistics tracking
├── pathfinding/         A* variants, BFS, spatial queries, transformers
│   ├── algorithms/      AStar.ts, AStar.DeepSpace.ts, AStar.HyperspaceLane.ts, BFS.ts, etc.
│   ├── spatial/         SpatialQuery.ts (tile proximity lookups)
│   └── transformers/    Path post-processing (ComponentCheck, MiniMap, SectorBoundaryCoercing)
├── utilities/           DebugSpan.ts, Line.ts
├── validations/         Username validation
└── worker/              Web Worker for off-main-thread game simulation
```

### `src/client/` subfolders

```
src/client/
├── bridge/              GameBridge between React and game sim; HUDStore (Zustand)
├── hud/                 30+ React HUD components (BuildMenu, Leaderboard, RadialMenu, etc.)
├── scene/               Three.js/Pixi scene: SpaceScene, SpaceMapPlane, UnitRenderer, WarpLane
├── shell/               App.tsx root + all modal/lobby components
├── sound/               SoundManager (Howler)
├── graphics/            PlayerIcons
├── styles/              CSS/Tailwind
└── utilities/           Diagnostic, GameConfigHelpers
```

---

## 4. Coding Conventions

### Execution pattern

Every player action is implemented as an `Execution` class in `src/core/execution/`. The interface:

```typescript
export interface Execution {
  isActive(): boolean;
  activeDuringSpawnPhase(): boolean;
  init(mg: Game, ticks: number): void;   // called once when added
  tick(ticks: number): void;              // called every tick while active
}
```

- `init()` validates preconditions and sets up state. If invalid, set `this.active = false`.
- `tick()` advances one step of the action. Never throw; just deactivate.
- Store a `private active: boolean = true` field; `isActive()` returns it.
- Store `private mg: Game` set during `init()` — do not pass it through the constructor.
- Use `PseudoRandom` (not `Math.random()`) for any randomness. Seed with a fixed value per
  execution type, or derive from `simpleHash(gameID)`.

### How intents flow to executions

```
Client: Transport.sendIntent({ type: "build_unit", unit: UnitType.Colony, tile }) 
→ GameServer receives, stamps with clientID, adds to Turn
→ Executor.createExec(intent) in src/core/execution/ExecutionManager.ts
→ new ConstructionExecution(player, UnitType.Colony, tile)
→ game.addExecution(exec)
→ exec.init(game, ticks) on next tick
→ exec.tick(ticks) each tick until isActive() === false
```

`ConstructionExecution` is the gateway for all `build_unit` intents — it handles construction time,
battlecruiser slot hosting, and then spawns the type-specific execution (e.g., `ColonyExecution`)
on completion.

### File-per-class

One file per Execution class, named `FooExecution.ts`. Group related files in subdirectories
(alliance/, nation/, utils/).

### Naming

- Classes: PascalCase (`AttackExecution`, `SpaceportExecution`)
- Enums: PascalCase values (`UnitType.Colony`, `TerrainType.AsteroidField`)
- Intent type strings: snake_case (`"build_unit"`, `"cancel_attack"`)
- Test maps: snake_case (`"ocean_and_land"`, `"big_plains"`)

### Credits vs population

- `Credits` is `bigint` — always use `BigInt` arithmetic, never regular number math.
- Population is a plain `number`.

### Config access

Game rules live in `Config` (interface in `src/core/configuration/Config.ts`). Access via
`mg.config()`. Never hardcode numeric constants in Execution files — look up the config method.

---

## 5. Common Commands

```bash
# Development
npm run dev                   # Start client (Vite :9000) + server (Node :3000) together
npm run start:client          # Client only
npm run start:server-dev      # Server only (GAME_ENV=dev)

# Build
npm run build-dev             # tsc typecheck + Vite dev build
npm run build-prod            # tsc typecheck + Vite production build

# Tests
npm test                      # All vitest unit tests (src + server)
npm run test:coverage         # Coverage report
npm run test:e2e              # Playwright E2E (headless)
npm run test:e2e:headed       # Playwright E2E (headed, for debugging)
npm run perf                  # Performance benchmarks

# Code quality
npm run lint                  # ESLint
npm run lint:fix              # ESLint auto-fix
npm run format                # Prettier (whole repo)

# Map generation
npm run gen-maps              # Go map generator → binary files + format
npm run docs:map-generator    # Go doc output for map-generator

# Run single vitest file
npx vitest run tests/Attack.test.ts
```

---

## 6. Gotchas

### Deterministic simulation is the hardest constraint

Never call `Math.random()`, `Date.now()`, or read any external state inside an Execution.
All randomness must use `PseudoRandom`. All Executions run on both client and server; any
non-determinism causes desync and silent divergence.

### Terrain is bit-encoded in `GameMapImpl`

`TileRef` is just a number (flat array index). Terrain type and magnitude are packed into a
single integer in `GameMapImpl`. The `terrainType()` method decodes them:
- magnitude < 10 → `OpenSpace`
- magnitude 10–19 → `Nebula`
- magnitude ≥ 20 → `AsteroidField`

`DeepSpace` and `DebrisField` are marked with a separate IS_LAND bit (not set). Never mutate
tile terrain directly — use `GameMap.setTerrainType()` which clamps to band midpoints.

### `isDeepSpace()` vs `isVoid()` vs `isSector()`

- `isSector(tile)` — tile is in habitable space (can be owned/attacked)
- `isVoid(tile)` — tile is void/deep space (cannot be owned)
- `isVoidShore(tile)` — border between sector and void (for pathfinding, not ownable)
- `isSectorBoundary(tile)` — edge of a sector touching void
- `isDeepSpace(tile)` — alias/related; used in AttackExecution to skip neighbors

A "VoidPocket" is an enclosed void tile surrounded by sector tiles (conceptually a lake). It
is NOT a TerrainType enum value — see the theme naming table below.

### `debug-planets.spec.ts` has a pre-existing TypeScript error

`tests/e2e/debug-planets.spec.ts` contains a type cast `window as unknown as {...}` that TypeScript
flags. This is intentional — the file is a diagnostic one-shot, not part of the regular suite.
Do not fix it unless asked; do not let it block CI.

### Worktrees live under `.claude/worktrees/` — do not analyze them

Claude Code spawns sub-agents in git worktrees at `.claude/worktrees/<name>/`. These are
transient copies of the repo. Never read, edit, or run commands targeting that directory from
within a worktree session.

### `Credits` is `bigint`

`player.credits()` returns `bigint`. Arithmetic with regular numbers causes runtime errors.
Always cast: `BigInt(someNumber)` or compare with `0n` not `0`.

### Test maps are separate from production maps

Unit tests load maps from `tests/testdata/maps/` (6 small maps). Production maps are in
`resources/maps/` (60+). Never reference `resources/maps/` from test code — it bloats test
runtime and the paths differ in CI.

### Server is a master+worker cluster

`src/server/Server.ts` forks into a Master process (HTTP/lobby on :3000) and one or more
Worker processes (game simulation on :3001, :3002, …). The Vite dev server proxies :9000 →
:3000. When debugging server behavior, check both `Master.ts` and `Worker.ts`.

### Alliance subdirectory

Alliance executions are in `src/core/execution/alliance/` not `src/core/execution/`. Don't
accidentally create new alliance files at the wrong level.

### `activeDuringSpawnPhase()`

Most executions return `false` here. Return `true` only if the execution must run before
players have spawned (e.g., `SpawnExecution` itself, `NationExecution`).

---

## 7. Theme Naming Reference

The game was renamed from a planet/ocean theme to a space theme. This table maps old concepts
to new names for use in code, UI strings, and map-generator comments.

| Space term (new) | Planet/Earth analogy | Notes |
|---|---|---|
| **DeepSpace** | Ocean | The impassable void between sectors. `isVoid()` / `isDeepSpace()` in code |
| **VoidPocket** | Lake | Enclosed DeepSpace tile inside a Sector. Conceptual, not a TerrainType enum value |
| **AsteroidField** | Mountain | `TerrainType.AsteroidField`, magnitude ≥ 20 |
| **Nebula** | Highland | `TerrainType.Nebula`, magnitude 10–19 |
| **OpenSpace** | Plains | `TerrainType.OpenSpace`, magnitude < 10 |
| **SectorBoundary** | Shore | `isSectorBoundary()` / `isVoidShore()` |
| **Station** | Island | Small isolated Sector surrounded by DeepSpace |
| **Sector** | Continent | A connected region of sector tiles |

**Critical:** "Ocean" renames to "DeepSpace", NOT "Void". "Void" alone is used in method
names (`isVoid`, `isVoidShore`) to mean the impassable deep space. Do not rename those
methods to "Ocean".
