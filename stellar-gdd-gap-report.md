# Stellar — GDD Alignment Report

**Purpose:** Rolling hand-off document tracking the current state of
OpenFront/Stellar against the Stellar Game Design Document (v0.1). Started
as a Traycer scoping doc; now used as a living status sheet updated after
every Tier.

**Repo:** `C:\Users\dorsc\Desktop\OpenFront`
**Branch surveyed:** `main`
**Last updated:** 2026-04-11
**Theme status:** Rebrand from naval/terrestrial RTS to space/sci-fi RTS
complete. The codebase's primitives now include Habitability, SectorMap,
Scout Swarm terraforming, Jump Gates, procedural maps, permadeath rejoin
gating, dynamic tick rates, and per-run RunScore. The remaining GDD
deltas are narrower and called out under **Still pending** below.

---

## 1. Executive Summary

Stellar now implements the GDD's core structural primitives. The
pre-implementation snapshot that used to live in §2 of this doc
(flat-tile-grid RTS with a sci-fi skin, no habitability, no scouts, no
roguelike loop, no procedural maps) is **no longer accurate** and has
been removed — see git history if you want the original survey.

The remaining deltas fall into three buckets:

1. **Cosmetic-to-semantic gaps** — things that exist in code but aren't
   first-class entities. The big one is `Planet`: sectors are tracked in
   `SectorMap` and score breakdowns count "planets conquered", but a
   standalone `Planet` class wrapping each sector is still not exposed
   on the `Game` interface (see Still Pending §A).
2. **Naming misalignments** — internal code still says `troops` /
   `credits`; the GDD says `population` / `resources`. A codebase-wide
   rename is in flight (Ticket 5); see Still Pending §B.
3. **Accepted deviations** — the combat model and the extra
   structure/unit roster diverge from the GDD and have explicit product
   decisions documented under `docs/ADR-0001-combat-model.md` and
   `docs/product-decisions.md`. These are **not** gaps — they are
   design-team calls.

---

## 2. Key Files (orientation for readers)

The underlying architecture has enough moving parts now that a quick
file map helps when tracking down where a given GDD row lives.

| Concern                   | File(s)                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| Sectors / habitability    | `src/core/game/SectorMap.ts`                                              |
| Scout Swarm terraforming  | `src/core/execution/ScoutSwarmExecution.ts`                               |
| Jump Gates                | `src/core/execution/JumpGateExecution.ts`, `HyperspaceLaneNetwork*.ts`    |
| LRW (Long-Range Weapon)   | `src/core/execution/OrbitalStrikePlatformExecution.ts`                    |
| Defense Satellite duel    | `src/core/execution/DefenseStationExecution.ts`                           |
| Procedural galaxy gen     | `src/core/game/ProceduralMapGen.ts`                                       |
| Dynamic tick-rate ramp    | `src/core/GameRunner.ts`, `src/server/GameServer.ts::maybeAdjustTickRate` |
| RunScore (GDD §10)        | `src/core/game/Game.ts::RunScore`, `WinCheckExecution.ts`                 |
| Permadeath rejoin gate    | `src/core/game/GameImpl.ts::canPlayerRejoin`                              |
| Win modal + run history   | `src/client/hud/WinModal.tsx`, `src/client/RunHistory.ts`                 |
| Singleplayer AI auto-ramp | `src/client/shell/modals/SinglePlayerModal.tsx`                           |

---

## 3. GDD-by-Section Gap Matrix

Legend:

- **MATCH** — implemented as specified
- **PARTIAL** — present but off-spec in tuning or completeness
- **GAP** — missing entirely, tracked under Still Pending §A–C
- **DEVIATION** — implemented differently on purpose; see linked decision record

| GDD § | Item                                                          | Status    | Notes                                                                                                                                                                         |
| ----- | ------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Last-player-standing win                                      | MATCH     | `WinCondition.Elimination` (GDD default). `Domination` kept as legacy alt mode.                                                                                               |
| 1     | Roguelike / permadeath loop                                   | MATCH     | `canPlayerRejoin` gates reconnect; `RunScore` + `RunHistory` persist to localStorage                                                                                          |
| 2     | Land objects as planets/asteroids/moons                       | PARTIAL   | Sectors are first-class via `SectorMap`; discrete `Planet` entity still not exposed — Still Pending §A                                                                        |
| 2     | Habitability states (Full/Partial/Uninhab)                    | MATCH     | Per-tile `effectiveHabitability` + per-player bucket counters in `SectorMap`                                                                                                  |
| 2     | Dual currency (population + resources)                        | PARTIAL   | Troops + Credits exist; rename to `Population` / `Resources` is Ticket 5 (§B below)                                                                                           |
| 2     | Limited slots per planet, stackable levels                    | PARTIAL   | Upgrade levels MATCH; per-planet slot cap lands with Planet entity (§A)                                                                                                       |
| 3.1   | Starting pop 100,000                                          | MATCH     | Config rewired to spec                                                                                                                                                        |
| 3.1   | +3%/s growth on habitable, 0% on partial                      | MATCH     | `SectorMap` bucket counters drive formulas; see `EconomyFormulas` tests                                                                                                       |
| 3.1   | Caps 100/km² full, 25/km² partial                             | MATCH     | `maxTroops = 100 × full + 25 × partial`                                                                                                                                       |
| 3.2   | +1 resource per km³/s on habitable+partial                    | MATCH     | `creditGen` sums bucket counters per tick                                                                                                                                     |
| 4     | Scout swarms, ~10% res launch cost, 2 AU/min                  | MATCH     | `ScoutSwarmExecution` + `UnitType.ScoutSwarm`                                                                                                                                 |
| 4     | Terraforming (stacking swarm to upgrade tile)                 | MATCH     | Shared per-tile accumulator on `Game`; multiple swarms stack                                                                                                                  |
| 4     | Control rules (0/1/2 structures)                              | PARTIAL   | Deferred until Planet slot cap lands (§A)                                                                                                                                     |
| 5     | Star Port                                                     | MATCH     | `Spaceport` with exponential cost curve                                                                                                                                       |
| 5     | Defense Satellite (blocks equal-tier, 10s cd)                 | MATCH     | `DefenseStation` + LRW-intercept loop in `DefenseStationExecution`                                                                                                            |
| 5     | Long-Range Weapon (3 AU/s, 100k, 10s cd, habitability damage) | MATCH     | `OrbitalStrikePlatform` + pending-LRW registry on `Game`                                                                                                                      |
| 5     | Jump Gate (buildable, instant travel, shareable)              | MATCH     | `UnitType.JumpGate`, `JumpGateExecution.ts`, alliance share supported                                                                                                         |
| 5     | Exponential cost scaling                                      | MATCH     | `2^n × base` used consistently                                                                                                                                                |
| 5     | Colony / Foundry / PointDefenseArray                          | DEVIATION | Not in GDD v0.1 — explicit keep decisions in `docs/product-decisions.md`                                                                                                      |
| 6     | Scout Fleet (temporary)                                       | MATCH     | ScoutSwarm                                                                                                                                                                    |
| 6     | Assault Fleet 100k pop + 100k res, 1 AU/min                   | PARTIAL   | AssaultShuttle cost + speed close; tuning sweep pending                                                                                                                       |
| 6     | 1:1 attrition with stacking                                   | DEVIATION | See `docs/ADR-0001-combat-model.md`                                                                                                                                           |
| 6     | Frigate + AntimatterTorpedo/NovaBomb/ClusterWarhead           | DEVIATION | Extra unit tier — explicit keep decisions in `docs/product-decisions.md`                                                                                                      |
| 7     | Trade between Star Ports via fleets                           | MATCH     | `TradeFreighter`                                                                                                                                                              |
| 7     | Fleets transport resources + population                       | PARTIAL   | Resources only; population-transport deferred                                                                                                                                 |
| 7     | Alliance gate sharing → colonization                          | MATCH     | Shared-ownership flag on Jump Gate pairs                                                                                                                                      |
| 8     | LRW vs Defense Satellite duel loop                            | MATCH     | See §5                                                                                                                                                                        |
| 9     | Procedural star systems 1–8 bodies                            | MATCH     | `ProceduralMapGen.ts` generates per-run maps                                                                                                                                  |
| 9     | Per-run unique maps + permadeath                              | MATCH     | `GameMapType.Random` + `canPlayerRejoin`                                                                                                                                      |
| 10    | Game speeds up as player expands                              | PARTIAL   | Client MATCH via `GameRunner.dynamicTurnIntervalMs(ratio)`; server uses wall-clock approximation — deliberate deviation, see `GameServer.ts::maybeAdjustTickRate` doc comment |
| 10    | AI grows faster each run                                      | MATCH     | `SinglePlayerModal` auto-sets difficulty from `aiDifficultyForWinCount(countWins())`                                                                                          |
| 10    | Scoring (planets / systems / survival time)                   | MATCH     | `RunScore` in the win update, rendered by `WinModal.renderRunScore`                                                                                                           |
| 11    | 3D Galactic Map                                               | PARTIAL   | 3D scene over a 2D tile grid; `PlanetLandmarks` still uses ad-hoc centroids (§A)                                                                                              |
| 11    | HUD panels (pop/res, fleet, construction, diplo)              | MATCH     | All present                                                                                                                                                                   |
| 11    | RTS-style click + hotkey controls                             | MATCH     | WASD/QE + 1-0 build + radial menu                                                                                                                                             |
| 12    | Win: eliminate rivals                                         | MATCH     | See §1                                                                                                                                                                        |
| 12    | Lose: all worlds lost or pop = 0                              | MATCH     | `numTilesOwned() == 0`                                                                                                                                                        |
| 12    | Permadeath / legacy score                                     | MATCH     | See §1 + RunHistory                                                                                                                                                           |
| 13    | Web target, 1–8 multiplayer                                   | MATCH     |                                                                                                                                                                               |
| 14    | Capital Ships as mobile one-slot planets                      | MATCH     | `Battlecruiser.setSlottedStructure` — Ticket 6                                                                                                                                |

---

## 4. Still Pending

Tier-1 through Tier-4 work items that **have** landed are listed under
§5 "Completed" below. The three items below are what's still open.

### §A — Discrete `Planet` entity

The GDD's "planet = first-class entity with id, size, habitability,
structures, slot cap, optional owner" is still implemented as two
separate things:

- `SectorMap` owns the tile-to-sector mapping and habitability buckets.
- `PlanetLandmarks.tsx` paints a cosmetic sphere using ad-hoc per-nation
  centroids computed at render time.

The next step is a `src/core/game/Planet.ts` that wraps each sector as a
`Planet` object with `id`, `sectorId`, `name`, `tileCount`, `volume`,
`habitabilityState`, `ownerId`, `structures[]`, `slotLimit`, a factory
that takes a `SectorMap`, a `planets()` accessor on `Game`/`GameImpl`,
and the `PlanetLandmarks` renderer wired to use those game-state
objects instead of recomputing centroids. Scoring and structure
placement should route through `Planet` rather than raw sector IDs
once the entity exists.

Dependencies: none blocking. Lands on top of the current `SectorMap`.

### §B — Troops/Credits → Population/Resources rename (Ticket 5)

The codebase still uses `troops()` / `credits()` / `Credits` / `addTroops`
/ `startManpower` / `DonateTroopsIntent` / `infiniteTroops` etc., while
the GDD says `population` / `resources`. This is a purely mechanical
codebase-wide rename across `Player`, `PlayerImpl`, `PlayerView`,
`Schemas.ts`, all executions, all intents, HUD labels, and `en.json`.

Already landed: `resources/lang/en.json` keys have been updated to the
`population` / `resources` naming; HUD components read from the new
keys. The code-side rename is the remaining chunk and is tracked as
Ticket 5 in the active work plan.

### §C — Minor tuning / completeness gaps (non-blocking)

- **Per-planet slot cap (GDD §4 "0/1/2 structures per planet").**
  Moves with §A; drops in once the Planet entity exists.
- **Population transport on trade fleets (GDD §7).** Fleets currently
  transport resources only. Non-blocking for the GDD's win/lose loop.
- **Assault Fleet cost/speed tuning sweep (GDD §6).** Close to spec but
  not exactly; lands with a general balance pass.
- **Server-side ramp precision (GDD §10).** Wall-clock approximation is a
  deliberate deviation — see `GameServer.ts::maybeAdjustTickRate`.

---

## 5. Completed

Moved here from the historical "Tier 1/2/3/4 work items". Each row is
landed on `main` and covered by tests; see `tests/` and the relevant
execution file for the specific harness.

### Tier 1 — Foundational primitives

- ~~**T1-A.** Habitability as a tile/planet property.~~
  → `SectorMap` + `habitabilityForTerrain()` + per-player bucket counters.
- ~~**T1-C.** Economy formulas rewired to GDD spec.~~ → `EconomyFormulas`
  tests cover the 100/25 cap and +3%/s growth rules.
- **T1-B.** `Planet` entity — **still pending, see §A.**
- **T1-D.** Currencies rename — **still pending, see §B.**

### Tier 2 — Missing gameplay systems

- ~~**T2-A.** Scout Swarm unit + Terraforming action.~~
- ~~**T2-B.** Jump Gate as a buildable structure + alliance sharing.~~
- ~~**T2-C.** Long-Range Weapon (OrbitalStrikePlatform).~~
- ~~**T2-D.** Defense Satellite with LRW-intercept duel loop.~~
- ~~**T2-E.** AU distance convention adopted by speed constants.~~
- **T2-F.** Combat model — **deliberate deviation, see ADR-0001.**

### Tier 3 — Roguelike meta layer

- ~~**T3-A.** Procedural galaxy generation.~~ → `ProceduralMapGen.ts` +
  `GameMapType.Random`.
- ~~**T3-B.** Permadeath + per-run scoring.~~ → `RunScore`, `RunHistory`,
  `canPlayerRejoin`, `WinModal.renderRunScore`, SinglePlayerModal auto-ramp.
- ~~**T3-C.** Dynamic tick-rate scaling.~~ → Client MATCH;
  server-side is a deliberate wall-clock approximation.

### Tier 4 — Capital ships as mobile planets

- ~~**T4-A.** Battlecruiser structure slot.~~ → `Unit.setSlottedStructure`.

### Tier 5 — Polish / cleanup

- ~~**T5-A.** `PathFinding.Water()` / `PathFinding.Air()` renamed to
  `DeepSpace` / `Vacuum`.~~ (see `PathFinding.DeepSpace.test.ts`)
- ~~**T5-B.** `"gold"` keys stripped from `resources/lang/en.json`.~~
- ~~**T5-C.** `CLAUDE.md` E2E notes updated for new unit names.~~

---

## 6. Things Already Well-Aligned

- Sci-fi naming across UI and units.
- HUD architecture covers every GDD panel.
- 3D R3F scene with starfield, warp-lane tubes, and orbiting planet
  spheres.
- Branding (`index.html`, `StellarGameLogo.tsx`, "Stellar.Game (ALPHA)"
  everywhere).
- Multiplayer 1–8, web target, alliance/trade/diplomacy scaffolding.
- Build/attack controls, radial menu, build hotkeys 1–0.
- Upgradable structures with exponential cost scaling.
- E2E test coverage (39 Playwright tests as of 2026-04-11).

---

## 7. Open Questions

Decisions previously listed here have been resolved and moved to their
dedicated decision records. What remains are only the questions that
still need product input.

| Question                                                                 | Status   | Decision record                            |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------ |
| Combat model: 1:1 attrition vs terrain-weighted sigmoid                  | DECIDED  | `docs/ADR-0001-combat-model.md`            |
| Colony / Foundry / PointDefenseArray / Frigate / Nukes — keep or remove  | DECIDED  | `docs/product-decisions.md`                |
| Capital ship slot count / valid structure types                          | DECIDED  | Battlecruiser hosts 1 slot (DS/OSP)        |
| Procedural map strategy (TS in-process vs Go offline)                    | DECIDED  | TS in-process (`ProceduralMapGen.ts`)      |
| AU ↔ tile conversion                                                    | DECIDED  | Adopted in `DefaultConfig.ts`              |
| **Currency naming (`Troops`→`Population`, `Credits`→`Resources`)**       | **OPEN** | Tracked as Ticket 5; see §B                |
| **Permadeath in multiplayer — session-long, or only singleplayer?**      | **OPEN** | Current default gates reconnect in SP only |
| **Per-planet slot cap final number (GDD §4 says 0/1/2 — confirm range)** | **OPEN** | Moves with Planet entity (§A)              |

---

## 8. Reporting rules

If you add, remove, or change a row in §3, also:

1. Bump **Last updated** at the top.
2. If the change resolves a Still Pending item, move the corresponding
   work-item line from §4 to §5.
3. If the change introduces a conscious deviation, create an ADR (or a
   row in `docs/product-decisions.md`) and mark the row `DEVIATION`
   with a link.
4. Never downgrade a `MATCH` to `GAP` silently — if something regresses,
   call it out in a PR description so the rollback is visible.

---

_Report originally generated 2026-04-09. Rolling updates thereafter._
