# Difficulty audit — 2026-05

Sweep performed under `plans/here-is-a-list-twinkly-dragonfly.md` §3.3.
Goal: ensure no `Difficulty` branch directly scales a human player's
economy, combat, or build cost. Nation/Bot scaling stays intact.

## Audit table

| Reference                                                      | File                           | Status | Notes                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scaleFleetUpkeep`                                             | `DefaultConfig.ts`             | OK     | Gated on `PlayerType.Nation`/`Bot`. Humans pay flat upkeep.                                                                                                                                                                                                          |
| `creditAdditionRate`                                           | `DefaultConfig.ts`             | OK     | Gated on `PlayerType.Nation`. Humans receive flat trickle.                                                                                                                                                                                                            |
| `maxPopulation` (Easy 0.5× → Impossible 1.25×)                 | `DefaultConfig.ts`             | OK     | Reached only via the `else` branch after `Bot` and `Human` early-returns. Humans use the un-scaled habitability cap.                                                                                                                                                  |
| `troopIncreaseRate` (0.9× → 1.05×)                             | `DefaultConfig.ts`             | OK     | `if (PlayerType.Nation)` gate. Humans skip the multiplier entirely.                                                                                                                                                                                                  |
| `NationExecution.getAttackRate`                                | `NationExecution.ts`           | OK     | Nation execution; never runs for humans.                                                                                                                                                                                                                              |
| `NationStructureBehavior.PDA_RATIO_BY_DIFFICULTY`              | `nation/*.ts`                  | OK     | Nation behavior file; humans don't trigger it.                                                                                                                                                                                                                        |
| `NationEmojiBehavior` Easy emoji bonus                         | `nation/*.ts`                  | OK     | Nation-only.                                                                                                                                                                                                                                                          |
| `NationNukeBehavior` random-tile count                         | `nation/*.ts`                  | OK     | Nation-only.                                                                                                                                                                                                                                                          |
| `NationBattlecruiserBehavior` retaliation chance               | `nation/*.ts`                  | OK     | Nation-only.                                                                                                                                                                                                                                                          |
| `NationClusterWarheadBehavior` hesitation odds                 | `nation/*.ts`                  | OK     | Nation-only.                                                                                                                                                                                                                                                          |
| `AiAttackBehavior.attackStrategiesInOrder`                     | `utils/*.ts`                   | OK     | Called from Nation behaviors only.                                                                                                                                                                                                                                    |
| `AttackExecution` relation change (Easy −60 → Impossible −100) | `AttackExecution.ts`           | OK     | Mutates the *target's* relation toward the attacker. Relations are consumed by Nation AI for diplomacy decisions; humans don't read relation values for their own play. No human-side stat is scaled. **No change.**                                                  |
| `DonateCreditsExecution.getCreditsChunkSize`                   | `DonateCreditsExecution.ts`    | OK     | Returns the relation-update chunk size, NOT the donation payload itself (payload comes from `defaultDonationAmount`). Functionally Nation-only — relations only matter for AI decisions. **No change.**                                                                |
| `DonatePopulationExecution.getMinPopulationForRelationUpdate`  | `DonatePopulationExecution.ts` | FIXED  | Was a per-Difficulty random band acting as a relation-update threshold. Even though the scaling only fed the relation system (Nation-side), the safer/cleaner fix per §3.3 is to collapse all Difficulty branches to the Hard tier. Humans now see consistent thresholds across all difficulties. |

## What changed

- `DonatePopulationExecution.getMinPopulationForRelationUpdate` reduced to
  the single Hard-tier formula `random.nextInt(max/9, max/7)`. Difficulty
  is no longer read in this function. Easy and Medium games no longer
  produce a "cheaper" relation threshold; Impossible no longer produces a
  more expensive one.

## Regression test

`tests/core/configuration/HumanDifficultyInvariants.test.ts` runs the
human formulas against all four `Difficulty` values and asserts identical
outputs.
