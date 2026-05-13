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

## Balance & gameplay decisions (May 2026 issue batch)

The May 12–13 2026 issue batch resolved three balance/gameplay questions
that previously lived in the gap report's "still pending" column. Each
is recorded here so future regressions can be diffed against a stable
decision record.

### 6. Build cap removed — players may build any number of any structure per planet

- **Current behavior:** No per-planet structure count cap. Players can
  stack any number of Colonies, Foundries, Spaceports, etc., on a single
  sector, limited only by available tiles, credits, and the exponential
  cost curve.
- **Decision:** **REMOVE** the hard per-structure build cap; cost scaling
  is the only economic gate.
- **Rationale:** The GDD's `0/1/2 structures per planet` rule was added
  to keep early-game planets from being trivially over-built, but the
  exponential `2^n × base` cost curve already imposes a steep
  diminishing-return on stacking. A hard cap on top of the cost curve
  was redundant and led to confusing "build refused — slot full" toasts
  when the player had ample resources and tiles. With cost-scaling as
  the only gate, players can spec into a structure type if they're
  willing to pay for it.
- **Gap report row:** `Limited slots per planet, stackable levels` —
  upgrade levels remain `MATCH`; per-planet slot cap is now
  `DEVIATION (accepted, build cap removed)`.

### 7. Battlecruisers carry no default weapon

- **Current behavior:** A Battlecruiser with an empty slot has no
  combat capability of its own — no default plasma fire, no built-in
  LRW intercept, no point defense. All offensive and defensive
  capability comes from the slotted structure (DefenseStation,
  OrbitalStrikePlatform, PointDefenseArray, Foundry).
- **Decision:** **KEEP** the no-default-weapon model. Combat
  effectiveness is driven entirely by which platform the cruiser hosts.
- **Rationale:** Capital ships are mobile one-slot planets (GDD §14).
  Giving them a default weapon would make the slot decision feel
  optional — "I already have plasma; the structure is just a bonus."
  The platform-driven model forces the slot to be a meaningful choice:
  the cruiser is *only* as combat-capable as the structure you load
  into it. This also keeps the host-only build pathway in
  `SpaceInputHandler` honest — an empty cruiser is genuinely
  defenceless until the player commits to a build.

### 8. Foundry hosted on a Battlecruiser provides a heal aura

- **Current behavior:** When a Battlecruiser hosts a Foundry, the
  Foundry repairs the cruiser (and only the cruiser) over time, capped
  at the cruiser's max health. Allied and hostile ships are excluded.
- **Decision:** **KEEP** the same-owner-only Foundry heal aura.
- **Rationale:** Battlecruisers cannot return to friendly space cheaply,
  so a slow self-heal gives the player a way to recover from skirmish
  damage without forcing a long retreat. Restricting the heal to the
  hosting ship's owner (not allies) keeps Foundry from doubling as an
  allied-fleet support module, which would over-extend its role beyond
  the trade loop.
