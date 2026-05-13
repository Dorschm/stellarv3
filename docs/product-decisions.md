# Stellar — Product Decisions Log

This document records explicit keep/remove/defer decisions for gameplay
content that exists in code but is **not** described in the Stellar GDD
v0.1. Each entry is a product-owner call, not an engineering call — do
not silently reopen the question in a PR; supersede the entry here first.

| Field        | Value                                                        |
| ------------ | ------------------------------------------------------------ |
| Last updated | 2026-05-13                                                   |
| Related      | `stellar-gdd-gap-report.md`, `docs/ADR-0001-combat-model.md` |

---

## Extra Units & Structures (not in GDD v0.1)

The GDD lists exactly **four** structures (Star Port, Defense Satellite,
Long-Range Weapon, Jump Gate) and a small fleet set (Scout Fleet, Assault
Fleet, Capital Ship, plus a single "Long-Range Weapon" as the only
strategic attack). The current codebase ships well beyond that. Each
extra entity below gets an explicit **Decision** line so the gap report
can stop listing them as open questions.

### 1. `Colony` — structure

- **Current behavior:** Upgradable structure, cost 125k → 1M (2^n),
  increases the owner's troop cap by 250k per level.
- **Decision:** **KEEP** — as a separate per-planet structure, distinct
  from the forthcoming `Planet` entity's intrinsic size cap.
- **Rationale:** The GDD's raw-tile-count population cap (100/km² full,
  25/km² partial) is geometric — it scales with planet size, not with
  player investment. Colonies give the player a _buildable_ population
  lever on top of that cap, which is a genuinely different gameplay axis
  and players already expect it. Folding it into Planet would force
  everyone to the raw cap; keeping it separate lets small-territory
  players invest into pop-density instead of land-grab.
- **Gap report row:** `Limited slots per planet / Colony structure` →
  change from `GAP` to `DEVIATION (accepted)`. Colony is part of the per-
  planet `slotLimit` set and counts toward the slot budget, but is not
  described by the GDD.

### 2. `Foundry` — structure

- **Current behavior:** Trade-frigate spawner sitting on a hyperspace
  lane. 125k → 1M cost curve. Required for the `Frigate` trade loop.
- **Decision:** **KEEP** — as an extension to the GDD §7 trade system.
- **Rationale:** GDD §7 only specifies TradeFreighter between Star Ports.
  The Foundry → Frigate pipeline is the existing richer trade path
  (hyperspace-lane auto-trade), and pulling it would regress the trade
  system to a strictly poorer version. When the GDD is next revised, §7
  should be extended to describe the Foundry → Frigate loop.
- **Gap report row:** list as `DEVIATION (accepted)`, not `GAP`.

### 3. `PointDefenseArray` — structure

- **Current behavior:** Dedicated nuke-interceptor satellite; cost 1.5M
  → 3M; 120-tick reload; launches `PointDefenseMissile` projectiles.
- **Decision:** **KEEP** — as a distinct structure from the GDD's
  `Defense Satellite` and the in-code `DefenseStation`.
- **Rationale:** We now have three tiers of defensive structure, each
  doing a different job:
  - `DefenseStation` (GDD's "Defense Satellite") — orbital aura, blocks
    equal-tier attacks.
  - `PointDefenseArray` — dedicated hard counter to nukes; only this
    structure can intercept AntimatterTorpedo / NovaBomb / ClusterWarhead
    projectiles before detonation.
  - `OrbitalStrikePlatform` (GDD's "Long-Range Weapon") — offensive.
- Folding PDA into DefenseStation would mean either DefenseStation
  gains a second behavior (intercepting nukes) — breaking GDD §5 which
  says it only blocks fleet-tier attacks — or PDA's interception is
  deleted entirely, leaving nukes uncounterable. Neither is acceptable.
- **Gap report row:** `Point Defense Array` → `DEVIATION (accepted)`.

### 4. `Frigate` — unit

- **Current behavior:** Auto-spawned trade train on hyperspace lanes
  (Engine / TailEngine / Carriage variants).
- **Decision:** **KEEP** — as the concrete unit for the Foundry trade
  loop (see Foundry above).
- **Rationale:** Remove-decision on Frigate is bundled with Foundry;
  keeping Foundry means keeping Frigate. Not independently dispositive.

### 5. `AntimatterTorpedo` / `NovaBomb` / `ClusterWarhead` — projectile weapons

- **Current behavior:** Three tiers of strategic nuke weapon, costs
  ranging from 750k → 25M+, each with its own explosion pattern (single
  blast / large blast / submunition scatter).
- **Decision:** **KEEP** — as a separate "nuke tier" alongside the GDD's
  Long-Range Weapon (implemented as `OrbitalStrikePlatform`).
- **Rationale:** The GDD only names LRW, but the three nuke types occupy
  a different strategic space: LRW is a per-structure repeatable strike
  (3 AU/s, 10s cd, ~10% pop damage), while the nukes are expensive,
  one-shot, large-AoE weapons. Players use them very differently —
  LRW to wear down a specific planet, nukes to swing a battle. Retiring
  the nuke tier would remove a layer of the late-game economy and force
  every "strategic attack" to route through a single structure type.
- **GDD update:** When the GDD is next revised, §6 / §8 should mention
  "strategic projectile weapons (Antimatter Torpedo / Nova Bomb / Cluster
  Warhead)" as the analog to the TerraNovum/OpenFront RTS nuke tier.
- **Gap report row:** three rows, all `DEVIATION (accepted)`.

---

## Summary for `UnitType`, `Structures`, and config changes

None of the decisions above require removing enum entries, switch cases,
or execution files. Every unit and structure currently in the codebase
is on the **keep** side of this decision sheet. That means:

- `UnitType` in `src/core/game/Game.ts` — unchanged.
- `unitInfo()` switch in `src/core/configuration/DefaultConfig.ts` —
  unchanged.
- Execution files in `src/core/execution/` — unchanged.

The only artifact of this decision log is:

1. This file.
2. A pointer from `stellar-gdd-gap-report.md` to this file, replacing
   the "Open Questions → unit keep/remove" bullets with "Decided, see
   product-decisions.md".

Any future change that wants to _remove_ one of these entities must land
a new entry here explaining the reversal and supersede the current row.

---

## 2026-05 — 11-issue Stellar fix batch

Locked in `chat:baa2648e-c415-4204-81db-b1bca9a860c2` and tracked in
`plans/here-is-a-list-twinkly-dragonfly.md`. Decisions that materially
change game rules:

- **Ground build limits removed on habitable terrain.**
  `Config.maxStructuresForHabitability` now returns
  `Number.POSITIVE_INFINITY` for partial / full habitability tiles
  (Nebula / OpenSpace). AsteroidField stays at 0 — terraforming is
  still a prerequisite for any structure. `Config.shuttleMaxNumber` is
  lifted to infinity as well.
  Battlecruiser slot count (1) is **unchanged**.
- **Capital-ship combat is entirely platform-driven.**
  A Battlecruiser with no slotted structure (or a non-weapon slot like
  Colony / Foundry / Spaceport / JumpGate) has **no anti-ship plasma
  bolt and no LRW intercept**. Combat capability now comes from the
  slot:
    - `OrbitalStrikePlatform` → cruiser fires LRW shots at enemy ships.
    - `DefenseStation` → mobile plasma-bolt anti-ship behaviour.
    - `PointDefenseArray` → mobile missile intercept.
  The legacy default-weapon code path is preserved behind a single
  config flag (`battlecruiserHasDefaultWeapon`, default `false`) so the
  policy is reversible without surgery. Two tests
  (`PlasmaBoltRandom.test.ts`, `BattlecruiserLrwIntercept.test.ts`)
  opt into the flag to keep coverage of the legacy methods.
- **Foundry-on-cruiser emits a heal aura.**
  Same-owner only, radius `Config.foundryHealRadius` (default 30
  tiles), rate `Config.foundryHealPerTick` (default +1 HP/tick).
  Heals Battlecruisers, AssaultShuttles, TradeFreighters, and
  ScoutSwarms within range.
- **Territory wake requires a Colony.**
  `BattlecruiserExecution.claimTerritoryRadius` now requires (a) the
  cruiser sits on a deep-space tile AND (b) a Colony is slotted. The
  cruiser in sector tiles or without a Colony lays no wake.
- **Logistic population growth, no habitability weighting.**
  `Config.troopIncreaseRate` replaced the previous
  `current × 0.003 × habShare + pow(current, 0.6)/8 + 10` formula with
  pure logistic
  `LOGISTIC_BASE_RATE × current × (1 − current/max) + 10`
  (`LOGISTIC_BASE_RATE = 0.006`). Habitability still drives
  `maxPopulation` but the curve itself is uniform regardless of where
  tiles sit.
- **Shuttle travel speed lifted to 1 tile/tick.**
  Intentional deviation from GDD §6 — see
  `stellar-gdd-gap-report.md` row 6 / Assault Fleet.
- **No human-side difficulty handicaps.**
  Per the audit in `docs/difficulty-audit-2026-05.md` no
  human-affecting `Difficulty` branch was found that scales economy,
  combat, or build cost.
  `DonatePopulationExecution.getMinPopulationForRelationUpdate`
  collapsed to the Hard-tier baseline for consistency. The Nation-only
  multipliers (Easy 0.5× pop cap → Impossible 1.25×) are kept as-is.
- **MRV cluster bomb performance.**
  Pure perf — submunition count (350), spread radius, and damage are
  unchanged. The single-tick spawn spike of 350 NukeExecutions is now
  drained over 7 ticks (50/tick) and `isOverlapping` was replaced with
  a spatial hash grid. The per-MIRV `PseudoRandom` sequence is
  preserved exactly so existing deterministic tests stay green.
