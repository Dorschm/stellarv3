# ADR-0001: Combat Model — Terrain-Weighted Sigmoid, not GDD 1:1 Attrition

| Field    | Value                                                       |
| -------- | ----------------------------------------------------------- |
| Status   | Accepted                                                    |
| Date     | 2026-04-11                                                  |
| Deciders | Stellar/OpenFront maintainers                               |
| Touches  | `src/core/configuration/DefaultConfig.ts::attackLogic`      |
| Related  | `stellar-gdd-gap-report.md` §3 (row: "1:1 attrition"), §7.1 |

## Context

The Stellar GDD §6 specifies a combat model of **1:1 attrition with stacking**:

> _"Assault fleets engaged in combat lose troops 1:1 with the defender.
> Multiple fleets attacking the same target sum their troop counts to
> form a single effective combat strength."_

The current implementation inherited from OpenFront takes a very different
approach. `DefaultConfig.attackLogic()` in `src/core/configuration/DefaultConfig.ts`
uses:

1. **Terrain magnitude weighting** — base attack magnitude varies by the
   `TerrainType` of the tile being conquered (`OpenSpace=80`, `Nebula=100`,
   `AsteroidField=120`) with matching `speed` factors.
2. **Fallout / habitability-damage modifiers** — falloutDefenseModifier()
   scales both magnitude and speed when the contested tile has residual
   damage from a Long-Range Weapon.
3. **Defense-station aura** — nearby DefenseStations multiply `mag` and
   `speed` by their tuning constants.
4. **Sigmoid debuff on large defenders** — `defenseSig` uses a sigmoid on
   `defender.numTilesOwned()` so defenders past a threshold lose relative
   survivability, approximating "empire overreach" without a hard cap.
5. **Bot-type multipliers** — a Human or Nation attacking a Bot receives an
   explicit 0.8 magnitude multiplier.
6. **Mixed loss formula** — the final `attackerTroopLoss` is a 70/30 blend
   of `currentAttackerLoss` (which scales with `defender.troops/attackTroops`)
   and `altAttackerLoss` (which scales with defender troop-per-tile density).

The net result is a model with far more tuning knobs than GDD §6's spec.
Stacking behavior is not implemented at all — multiple simultaneous attacks
on a target do not sum; each attack resolves against the defender
independently.

## The decision we need

Should the combat model be:

- **Option A — Align with the GDD.** Strip `attackLogic()` down to raw
  `1:1` attacker/defender troop loss, implement attacker stacking so
  multiple fleets aimed at the same target combine their effective troop
  counts, and delete the terrain/sigmoid/bot-type modifiers.

- **Option B — Keep the current model as a conscious deviation.** Accept
  that Stellar's combat is intentionally richer than the GDD's prose, and
  document in the gap report that this row is "intentional deviation — not
  a gap".

## Decision

**We keep the current terrain-weighted sigmoid combat model (Option B) as a
conscious, deliberate deviation from GDD §6.**

The GDD's "1:1 with stacking" language was written before the OpenFront
codebase was adopted as the Stellar base. The richer model:

1. **Produces more varied outcomes on non-uniform maps.** Asteroid fields
   are painful to push through; nebulas are a middle ground; open space
   flows. This gives terrain real gameplay meaning, which the GDD §2
   habitability system _also_ assumes tiles have.
2. **Balances large empires against small ones.** The defender-size sigmoid
   and the attacker-size bonus together produce a natural "underdog
   comeback" curve that a pure 1:1 model does not, and without this curve
   the late-game devolves into whoever-has-the-biggest-pool-wins.
3. **Is tuned against a thousand hours of existing playtesting.** Throwing
   it out would require a full re-balance pass that is explicitly out of
   scope for the current Stellar alignment work.
4. **Is already consistent with other GDD-aligned systems** — defense
   stations, habitability damage, and the fallout modifier all hook into
   the same `attackLogic()` and would need to be re-introduced on top of a
   naked 1:1 model anyway, recreating most of the current complexity under
   a different name.

Stacking is a separate question. The GDD's "multiple fleets sum" phrasing
is implicitly supported today via player-level troop donation + single
larger assaults; explicit mid-flight fleet merging is not implemented and
is not currently planned. If player feedback calls for stacking later, it
should land as a separate ADR.

## Consequences

- **`DefaultConfig.attackLogic()` is not refactored.** The terrain
  magnitude, defense-station bonus, fallout modifier, sigmoid debuff, and
  attacker-size bonus remain as written at lines ~833–958 of
  `DefaultConfig.ts`.
- **`stellar-gdd-gap-report.md`** is updated (see Comment 7 of the current
  task) to mark the `1:1 attrition` row as `DEVIATION (accepted)` with a
  pointer back to this ADR rather than `GAP`.
- **The GDD itself should be updated** on the next editorial pass to match
  the actual design: "Combat uses a terrain-weighted attrition model with
  size-balance sigmoid debuffs. Fleets do not mid-flight merge; effective
  stacking is achieved by donating troops before launch." This is left as
  a doc-only TODO for the GDD owner.
- **Any future call to "simplify combat to match the GDD"** should
  reference and refute this ADR rather than silently re-opening the
  discussion. Write a superseding ADR if the decision is reversed.

## Alternatives considered (rejected)

- **Pure 1:1 attrition, no stacking, no modifiers.** Simplest, matches the
  GDD literally, but loses all the gameplay texture tied to terrain and
  empire size. Rejected — gameplay feel regression is larger than the
  documentation-alignment win.
- **1:1 attrition with explicit stacking and terrain multipliers
  retained.** A midpoint: keep terrain weighting but strip the sigmoid and
  the mixed loss formula. Rejected — the sigmoid is specifically what
  prevents the largest player from snowballing uncontested, and removing
  it without a replacement would break large-game balance.
