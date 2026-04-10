# Stellar — GDD Alignment Report

**Purpose:** Hand-off document for Traycer to plan the work needed to bring the current OpenFront/Stellar codebase into alignment with the Stellar Game Design Document (v0.1).

**Repo:** `C:\Users\dorsc\Desktop\OpenFront`
**Branch surveyed:** `main` (latest commit `81379bd`)
**Theme status:** The codebase was rebranded from a naval/terrestrial RTS to a space/sci-fi RTS in commit `c09a93d`. User-facing naming is largely sci-fi; internal architecture is still a flat tile-grid conquest game.

---

## 1. Executive Summary

The current game is a **polished tile-conquest RTS with a sci-fi skin**. The GDD asks for a **roguelike RTS built around discrete planets, habitability progression, scouting/terraforming, and procedural star systems**. Visual and terminology work is largely done. The missing pieces are structural — the game's core gameplay primitives (tiles, troops, credits, static maps) don't yet map to the GDD's primitives (planets, population, resources, procedural systems).

**Five structural deltas drive most of the work:**

1. **No discrete planet entity** — "planets" exist only as cosmetic spheres over territory. The GDD needs them as first-class objects that own structures, have a size, and have a habitability state.
2. **No habitability model** — tiles have terrain types (defense modifiers), not `Uninhabitable / Partial / Full` states that gate population growth and resource generation.
3. **No scout/terraforming loop** — the `Explore → Terraform → Build → Expand` front half of the GDD loop does not exist; the game starts in conquest.
4. **No procedural galaxy generation** — three static binary maps (`AsteroidBelt`, `SolSystem`, `OrionSector`) are the only options. The GDD calls for random 1–8-body star systems per run.
5. **No roguelike meta-layer** — no permadeath, no per-run scoring, no difficulty ramp between runs.

Almost everything else (currencies, structures, fleets, combat numbers, win/lose) is **close but numerically off-spec** — the shapes are right, the constants are wrong.

---

## 2. Current State Snapshot

### 2.1 Core primitives

- **Map:** Flat tile grid (`src/core/game/GameMap.ts`). Maps are pre-generated binary files loaded from `/maps/*/map.bin`. Terrain types: `OpenSpace`, `Nebula`, `AsteroidField`, `DebrisField`, `DeepSpace` — all affect defense and movement, none represent habitability.
- **Player state:** `Troops` (soldier pool) + `Credits` (bigint currency) — conceptually dual-currency, matching the GDD's "population + resources" intent.
- **Planets:** Purely visual — `src/client/scene/PlanetLandmarks.tsx` draws a sphere over each nation's territory centroid. No gameplay meaning.

### 2.2 Economy (`src/core/configuration/DefaultConfig.ts`)

| Metric                | Value                                                           | GDD target                        |
| --------------------- | --------------------------------------------------------------- | --------------------------------- |
| Human starting troops | 25,000                                                          | 100,000                           |
| Credit gen (human)    | 100/tick flat                                                   | +1 per km³/s on habitable/partial |
| Troop growth          | `10 + pow(troops, 0.73)/4` with soft cap                        | +3%/s on habitable, 0% on partial |
| Troop cap             | `2 × (pow(numTiles, 0.6) × 1000 + 50k) + Σ colony.level × 250k` | 100/km² habitable, 25/km² partial |

### 2.3 Structures (all in `src/core/execution/`)

| Current                 | Cost scaling    | GDD match                                                                                                                   |
| ----------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Spaceport`             | 125k → 1M (2^n) | **Star Port** ✓ (cost curve close; GDD: 100k→200k→500k→1M)                                                                  |
| `DefenseStation`        | 50k → 250k      | **Defense Satellite** (partial — planet-side area buff, not interceptor)                                                    |
| `PointDefenseArray`     | 1.5M → 3M       | Not in GDD, but behaves like a nuke-interceptor satellite                                                                   |
| `OrbitalStrikePlatform` | 1M              | Closest analog to **Long-Range Weapon**, but mechanics differ (plasma bolts, 75-tick cd, no AU distance, no 10% pop damage) |
| `Colony`                | 125k → 1M       | No direct GDD analog; currently increases troop cap by 250k per level                                                       |
| `Foundry`               | 125k → 1M       | Not in GDD; spawns trade frigates on hyperspace lanes                                                                       |
| _(missing)_             | —               | **Jump Gate** — does not exist as a buildable. Hyperspace lanes auto-generate between trade hubs.                           |

There is **no per-planet slot limit** — structures just need 15 tiles of spacing (`structureMinDist()`).

### 2.4 Fleets & units (all in `src/core/execution/`)

| Unit                                                | Role                                                            | Status vs GDD                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `AssaultShuttle`                                    | Player-launched attack, max 3 active, uses `troops/5`           | Closest to **Assault Fleet**, but wrong cost (GDD: 100k pop + 100k resources) and no AU-based travel |
| `Battlecruiser`                                     | Mobile patrol, 1000 HP, plasma bolts, self-heals near Spaceport | Closest to **Capital Ship**, but **not** a structure host — cannot act as a "one-slot planet"        |
| `Frigate`                                           | Auto-spawned trade train on hyperspace lanes                    | Not in GDD                                                                                           |
| `TradeFreighter`                                    | Auto-spawned Spaceport-to-Spaceport trade                       | Supports GDD §7 trade in spirit                                                                      |
| `AntimatterTorpedo` / `NovaBomb` / `ClusterWarhead` | Nukes, 750k / 5M / 25M+                                         | Not in GDD; richer than the spec's single "Long-Range Weapon"                                        |
| _(missing)_                                         | —                                                               | **Scout Fleet / Scout Swarm** — no such unit; no terraforming action exists                          |

### 2.5 Combat (`src/core/execution/AttackExecution.ts`, `DefaultConfig.ts:576-702`)

Current attack model is terrain-magnitude sigmoid with defender-size debuffs and attacker-size buffs. GDD specifies **1:1 attrition with stacking for strength** — the current model is significantly more complex.

### 2.6 Diplomacy & Trade (`src/core/game/AllianceImpl.ts`, `TradeHub.ts`)

- Alliances: 3000-tick (5 min) duration, can be extended, breakable, cause betrayal counters.
- Trade: freighters between Spaceports, frigates along hyperspace lanes.
- **Missing:** Alliance-based **jump gate sharing** (the GDD's "grants colonization access to nearby systems").

### 2.7 Win/Lose (`src/core/execution/WinCheckExecution.ts`)

- FFA win at 80% non-fallout tiles owned; team win at 95%. Hard limit at 10,200 ticks (170 min).
- Elimination = `numTilesOwned() == 0`.
- **No permadeath**, no per-run scoring, no legacy/meta progression.

### 2.8 Map & Procedural Generation

- **Static maps only.** Three binary maps loaded via `src/core/game/FetchGameMapLoader.ts`. A Go-based external `map_generator` exists but runs offline.
- Only randomization in-game is player spawn positions (`isRandomSpawn`).

### 2.9 Client / HUD / 3D scene (`src/client/`)

- **Theme:** Complete — `StellarGameLogo.tsx`, `index.html` title ("Stellar.Game (ALPHA)"), space-themed CSS, starfield background, glowing warp-lane tubes, floating planet spheres.
- **HUD coverage:** All GDD-required panels exist — `ControlPanel` (pop+credits+attack ratio), `BuildMenu`, `RadialMenu`, `Leaderboard`, `PlayerPanel`, `AttacksDisplay`, `UnitDisplay`, settings, chat, modals.
- **Scene:** R3F 3D canvas (`SpaceScene.tsx`) with angled camera and starfield. Under the hood it still renders a flat tile plane (`SpaceMapPlane.tsx`) — the "3D galactic map" look is cosmetic over a 2D grid.
- **Controls:** RTS-style — WASD pan, QE zoom, 1-0 build hotkeys, T/Y attack ratio, B/G attack commands, right-click radial menu.
- **Residual legacy terms:** `PathFinding.Water()` / `PathFinding.Air()` in code; `leaderboard.gold` and `player_panel.gold` keys in `resources/lang/en.json`.

---

## 3. GDD-by-Section Gap Matrix

Legend: **MATCH** = implemented as specified · **PARTIAL** = present but off-spec · **GAP** = missing entirely

| GDD § | Item                                                           | Status  | Notes                                                                               |
| ----- | -------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| 1     | Last-player-standing win                                       | PARTIAL | Uses 80/95% tile threshold, not strict elimination                                  |
| 1     | Roguelike / permadeath loop                                    | GAP     | No run structure at all                                                             |
| 2     | Land objects as planets/asteroids/moons                        | GAP     | Flat tile grid; planets are cosmetic                                                |
| 2     | Habitability states (Full/Partial/Uninhab)                     | GAP     | Only terrain types affecting defense                                                |
| 2     | Dual currency (population + resources)                         | PARTIAL | Troops + Credits exist; formulas don't match GDD                                    |
| 2     | Limited slots per planet, stackable levels                     | PARTIAL | Upgrade levels ✓, no slot cap                                                       |
| 3.1   | Starting pop 100,000                                           | GAP     | 25,000                                                                              |
| 3.1   | +3%/s growth on habitable, 0% on partial                       | GAP     | Power-curve formula, no habitability                                                |
| 3.1   | Caps 100/km² full, 25/km² partial                              | GAP     | Tile-count based                                                                    |
| 3.2   | +1 resource per km³/s on habitable+partial                     | GAP     | Flat 100/tick                                                                       |
| 4     | Scout swarms, 10% res launch cost, 2 AU/min                    | GAP     | No scout unit                                                                       |
| 4     | Terraforming (10 swarm/km² to upgrade)                         | GAP     | Not implemented                                                                     |
| 4     | Control rules (0/1/2 structures)                               | GAP     | Not implemented                                                                     |
| 5     | Star Port                                                      | MATCH   | Spaceport, cost curve close                                                         |
| 5     | Defense Satellite (blocks equal-tier, 10s cd)                  | PARTIAL | DefenseStation (planet-side aura) + PointDefenseArray (nuke intercept, 120-tick cd) |
| 5     | Long-Range Weapon (3 AU/s, 100k, 10s cd, 10% pop/habit damage) | GAP     | OrbitalStrikePlatform is the closest but differs completely                         |
| 5     | Jump Gate (buildable, instant travel, shareable)               | GAP     | Hyperspace lanes auto-generate between trade hubs                                   |
| 5     | Exponential cost scaling                                       | MATCH   | `2^n × base` used everywhere                                                        |
| 6     | Scout Fleet (temporary)                                        | GAP     | Absent                                                                              |
| 6     | Assault Fleet 100k pop + 100k res, 1 AU/min                    | PARTIAL | AssaultShuttle uses `troops/5`, 3-max, tile-speed                                   |
| 6     | 1:1 attrition with stacking                                    | GAP     | Combat model is far more complex                                                    |
| 7     | Trade between Star Ports via fleets                            | MATCH   | TradeFreighter / Frigate                                                            |
| 7     | Fleets transport resources + population                        | PARTIAL | Only resources (credits), not population                                            |
| 7     | Alliance gate sharing → colonization                           | GAP     | No gates to share                                                                   |
| 8     | Long-Range Weapon vs Defense Satellite duel loop               | GAP     | See §5                                                                              |
| 9     | Procedural star systems 1–8 bodies                             | GAP     | 3 static binary maps                                                                |
| 9     | Per-run unique maps + permadeath                               | GAP     | Static maps, rejoinable runs                                                        |
| 10    | Game speeds up as player expands                               | GAP     | Fixed 100ms tick                                                                    |
| 10    | AI grows faster each run                                       | PARTIAL | Difficulty setting exists, not per-run                                              |
| 10    | Scoring (planets / systems / survival time)                    | GAP     | Only winner declared                                                                |
| 11    | 3D Galactic Map                                                | PARTIAL | 3D scene over a 2D tile grid                                                        |
| 11    | HUD panels (pop/res, fleet, construction, diplo)               | MATCH   | All present                                                                         |
| 11    | RTS-style click + hotkey controls                              | MATCH   | WASD/QE + 1-0 build hotkeys + radial menu                                           |
| 12    | Win: eliminate rivals                                          | PARTIAL | Tile % threshold                                                                    |
| 12    | Lose: all worlds lost or pop = 0                               | MATCH   | `numTilesOwned() == 0`                                                              |
| 12    | Permadeath / legacy score                                      | GAP     | Absent                                                                              |
| 13    | Web target, 1–8 multiplayer                                    | MATCH   | Both covered                                                                        |
| 14    | Capital Ships as mobile one-slot planets                       | PARTIAL | Battlecruiser is mobile + HP, but cannot host structures                            |

---

## 4. Recommended Work — Prioritized

### Tier 1 — Foundational primitives (unblocks everything else)

**T1-A. Introduce `Habitability` as a tile/planet property**

- Add enum `Habitability = { Uninhabitable, Partial, Full }`.
- Tile-level storage in `GameMap.ts` (another bit in the `TileRef` encoding, or a parallel buffer).
- Expose via `Tile`/`GameView` API.
- Touch points: `src/core/game/GameMap.ts`, `src/core/game/Game.ts`, `src/core/game/GameImpl.ts`, `src/core/game/GameView.ts`.

**T1-B. Introduce a `Planet` entity**

- A `Planet` is a cluster of contiguous tiles with: `id`, `size` (tile count = km²), `volume` (km³), `habitability`, `structures[]`, `slotLimit`, optional `ownerId`.
- Either (a) group tiles into planets at map-load time (recommended — least disruptive), or (b) move to a graph-of-planets model and retire the tile grid (high effort).
- Add `src/core/game/Planet.ts` and integrate with spawn/ownership/structure placement.
- This is the single most important change. Almost every other GDD item assumes planets exist as entities.

**T1-C. Rewire economy formulas to GDD spec**

- Starting pop → 100,000 (human).
- Growth: `+3%/s` on Full habitable planet tiles, `0%` on Partial, `0%` on Uninhabitable.
- Cap: `100 × tiles_full + 25 × tiles_partial` (km² ↔ tile equivalence).
- Resources: `+1 × km³/s` on Full + Partial planet tiles, where km³ derives from planet size.
- Touch points: `src/core/configuration/DefaultConfig.ts:773-849`, `src/core/execution/PlayerExecution.ts:77-78`.

**T1-D. Rename currencies end-to-end**

- `Troops → Population`, `Credits → Resources`.
- Remove remaining `"gold"` keys from `resources/lang/en.json` (`leaderboard.gold`, `player_panel.gold`).
- Touch points: `Player.ts`, `PlayerImpl.ts`, every HUD component in `src/client/hud/`, `resources/lang/en.json`, and any text currently saying "Troops"/"Credits".

### Tier 2 — Missing gameplay systems

**T2-A. Scout Swarm unit + Terraforming action**

- New `UnitType.ScoutSwarm` (temporary; dies on completion or timeout).
- Launch cost: 10% of current resources.
- Travel speed: 2 AU/min (requires establishing an AU distance convention — see T2-E).
- Action: accumulate swarm on a target Uninhabitable planet. At 10 swarm/km², flip to Partial.
- Touch points: new `src/core/execution/ScoutSwarmExecution.ts`, `UnitType` enum in `Game.ts`, `BuildMenu.tsx`, `RadialMenu.tsx`, `UnitRenderer.tsx`.

**T2-B. Jump Gate as a buildable structure**

- Replace auto-generating hyperspace lanes with player-built Jump Gates. Lanes form between gate pairs owned by the same player (or shared via alliance).
- Alliance gate sharing: `AllianceImpl` flag + `canUseGate(player)` check.
- Touch points: `src/core/game/HyperspaceLane.ts`, `HyperspaceLaneNetworkImpl.ts`, `TradeHub.ts`, `ConstructionExecution.ts`, `BuildMenu.tsx`, `RadialMenu.tsx`, `src/client/scene/WarpLaneRenderer.tsx`.

**T2-C. Long-Range Weapon structure**

- New structure (or reshape `OrbitalStrikePlatform`): 3 AU/s projectile, 100k resource cost per shot, 10s cooldown, reduces target's population and habitability by 10% on hit.
- Touch points: `src/core/execution/OrbitalStrikePlatformExecution.ts` or new file, `DefaultConfig.ts`, `BuildMenu.tsx`.

**T2-D. Defense Satellite (orbital, equal-tier block, 10s cd)**

- Distinct from the planet-side `DefenseStation` and the nuke-interceptor `PointDefenseArray`. Blocks incoming equal-tier attacks (LRW + fleets) on a 10-second reload.
- Touch points: new execution file, `BuildMenu.tsx`, `UnitType` enum.

**T2-E. AU distance convention**

- Introduce an `AU = N tiles` constant so scout (2 AU/min), assault fleet (1 AU/min), and long-range weapon (3 AU/s) all use the same unit.
- Touch points: `DefaultConfig.ts`, any execution file that sets speeds.

**T2-F. Fleet model adjustments**

- Assault Fleet cost → `100k population + 100k resources`.
- Decide whether to simplify combat to the GDD's 1:1 attrition + stacking, or keep the current terrain-weighted model as a conscious deviation.
- Touch points: `src/core/execution/AssaultShuttleExecution.ts`, `AttackExecution.ts`, `DefaultConfig.ts:576-702`.

### Tier 3 — Roguelike meta layer

**T3-A. Procedural galaxy generation**

- Generate a fresh map per run: N star systems, each with 1–8 celestial bodies, random landmass, 10% partial habitability, random resource modifier.
- Options: (a) port the existing Go `map_generator` to TypeScript for in-process generation; (b) add a "Random" map entry that generates a `.bin` on the fly.
- Touch points: new `src/core/game/ProceduralMapGen.ts`, `src/core/game/FetchGameMapLoader.ts`, `GameMapLoader.ts`, lobby/map-select UI.

**T3-B. Permadeath + per-run scoring**

- Track planets conquered, systems controlled, survival time. Persist a run log (`localStorage` initially, server endpoint later).
- Flip Stellar mode's win condition to **strict elimination** (no rivals alive) rather than `≥ 80% tiles owned`. Keep the current mode as an alt ruleset if desired.
- Touch points: `src/core/execution/WinCheckExecution.ts`, new `src/core/game/RunScore.ts`, `src/client/hud/WinModal.tsx`, new meta/legacy screen.

**T3-C. Dynamic tick-rate scaling**

- Scale `turnIntervalMs` downward as a player's controlled population/planet count grows, so late-game plays faster than early-game.
- Touch points: `GameRunner.ts` / `ServerGameRunner.ts`, `DefaultConfig.ts`.

### Tier 4 — Capital Ships as mobile planets

**T4-A. Battlecruiser hosts a structure**

- Give `Battlecruiser` a single structure slot (probably limited to `DefenseSatellite` or `LongRangeWeapon`).
- Add "Build on capital ship" action in `RadialMenu.tsx`.
- Render the attached structure on the ship mesh.
- Touch points: `src/core/execution/BattlecruiserExecution.ts`, `ConstructionExecution.ts`, `RadialMenu.tsx`, `src/client/scene/UnitRenderer.tsx`.

### Tier 5 — Polish / cleanup

- **T5-A.** Rename `PathFinding.Water()` / `PathFinding.Air()` → `DeepSpace` / `Vacuum` (last legacy naval terms).
- **T5-B.** Strip `"gold"` keys from `resources/lang/en.json`; audit for any other naval residue.
- **T5-C.** Update `CLAUDE.md` E2E test notes if fleet/structure names change.

---

## 5. Suggested Starting Sequence

If Traycer wants one concrete starting point, the highest-leverage foothold is **T1-A + T1-B** (habitability + planet entity), then **T1-C + T1-D** (economy + rename), and only then the Tier 2 systems on top. Almost every other GDD delta is cheaper once planets and habitability exist as primitives.

A reasonable first PR boundary:

1. **PR 1:** Add `Habitability` enum + `Planet` entity, group tiles into planets at load time, expose planets on `GameView`. No behavior change yet.
2. **PR 2:** Rewire population/resource generation to use the new planet/habitability model. Update HUD labels.
3. **PR 3:** Scout Swarm + Terraforming loop (first new gameplay system on the new foundation).

---

## 6. Things Already Well-Aligned (no work needed)

- Space/sci-fi naming across UI and units: `Battlecruiser`, `Spaceport`, `Antimatter Torpedo`, `Nova Bomb`, `Cluster Warhead`, `Hyperspace Lane`, `Plasma Bolt`, `Orbital Strike Platform`, `Point Defense Array`.
- HUD architecture covers every panel the GDD asks for.
- 3D R3F scene with starfield, warp-lane tubes, and orbiting planet spheres is visually on-brief.
- Branding: `index.html`, `StellarGameLogo.tsx`, "Stellar.Game (ALPHA)" everywhere.
- Multiplayer 1–8, web target, alliance/trade/diplomacy scaffolding.
- Build/attack controls, radial menu, build hotkeys 1–0.
- Upgradable structures with exponential cost scaling.
- E2E test coverage (25 Playwright tests passing as of 2026-04-06).

---

## 7. Open Questions for Product Decisions

Traycer (or the product owner) should decide before implementation starts:

1. **Combat model:** Simplify `AttackExecution` to the GDD's 1:1 attrition + stacking, or keep the current richer terrain-weighted formula as a deliberate deviation?
2. **`PointDefenseArray` and `OrbitalStrikePlatform`:** GDD only lists four structures (Star Port, Defense Satellite, Long-Range Weapon, Jump Gate). Do we keep PDA/OSP as extensions, fold them into Defense Satellite / Long-Range Weapon, or delete them?
3. **`Foundry`, `Frigate`, `TradeFreighter`:** Not in the GDD. Keep (extended trade system), or remove to match spec?
4. **Nukes (`AntimatterTorpedo`, `NovaBomb`, `ClusterWarhead`):** Not in the GDD — the only strategic weapon it names is Long-Range Weapon. Keep as a separate nuke tier, or retire and rely solely on LRW?
5. **Procedural map strategy:** Port the Go generator to TypeScript for in-process gen, or keep it offline and ship N pre-generated random seeds per run?
6. **Permadeath in multiplayer:** GDD says permadeath. Does this apply to multiplayer runs too (where a player dropping means they're out for the session), or only to singleplayer campaign mode?
7. **Capital ship slot count:** GDD says "one slot". Which structure types are valid in that slot?
8. **AU ↔ tile conversion:** What is the base conversion? (Needed so "2 AU/min" and "1 AU/min" and "3 AU/s" all land on sensible tile speeds for the current map sizes.)

---

_Report generated 2026-04-09 from a full codebase survey of `C:\Users\dorsc\Desktop\OpenFront` against the Stellar GDD v0.1._
