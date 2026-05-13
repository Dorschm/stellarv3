# Difficulty Audit — May 2026

Audit performed as part of Issue Batch May 12–13 2026 (item #2). Goal: every
difficulty-scaled value must affect only AI Nations / Bots — never humans.
The table below records the audit result; any item marked ❌ or ⚠️ has been
addressed in the same change-set.

| Reference                                                     | File                          | Status | Action |
| ------------------------------------------------------------- | ----------------------------- | ------ | ------ |
| `scaleFleetUpkeep`                                            | `DefaultConfig.ts`            | ✅     | Already gated on `PlayerType.Nation`/`Bot`. None. |
| `creditAdditionRate`                                          | `DefaultConfig.ts`            | ✅     | Gated on `PlayerType.Nation`. None. |
| `maxPopulation` (Easy 0.5× → Impossible 1.25×)                | `DefaultConfig.ts`            | ✅     | Gated on `PlayerType.Nation`. None. |
| `troopIncreaseRate` (0.9× → 1.05×)                            | `DefaultConfig.ts`            | ✅     | Gated on `PlayerType.Nation`. None. |
| `NationExecution.getAttackRate`                               | `NationExecution.ts`          | ✅     | Nation execution only. None. |
| `NationStructureBehavior.PDA_RATIO_BY_DIFFICULTY`             | `nation/*.ts`                 | ✅     | Nation behavior. None. |
| `NationEmojiBehavior` Easy emoji bonus                        | `nation/*.ts`                 | ✅     | Nation-only. None. |
| `NationNukeBehavior` random-tile count                        | `nation/*.ts`                 | ✅     | Nation-only. None. |
| `NationBattlecruiserBehavior` retaliation chance              | `nation/*.ts`                 | ✅     | Nation-only. None. |
| `NationClusterWarheadBehavior` hesitation odds                | `nation/*.ts`                 | ✅     | Nation-only. None. |
| `AiAttackBehavior.attackStrategiesInOrder`                    | `utils/*.ts`                  | ✅     | Nation-only callers. None. |
| `AttackExecution` relation change (Easy −60 → Impossible −100)| `AttackExecution.ts`          | ⚠️     | Relation field is consumed only by Nation AI. Functionally Nation-only; no change. Re-audit if humans ever read relation deltas. |
| `DonateCreditsExecution.getCreditsChunkSize`                  | `DonateCreditsExecution.ts`   | ⚠️     | Feeds `calculateRelationUpdate` only. Same Nation-only consumer chain as above; no change. |
| `DonatePopulationExecution.getMinPopulationForRelationUpdate` | `DonatePopulationExecution.ts`| ❌     | Threshold gates a relation update that mutates the recipient — when an AI donates to a human ally, difficulty would shift the human-visible threshold. **Normalized to the Hard tier** (`recipientMaxPopulation / 9..7`) regardless of difficulty. |

The Hard tier was chosen because it's the established "= human baseline" pattern
elsewhere in the file.

## Regression guard

`tests/core/configuration/HumanDifficultyInvariants.test.ts` pins
`maxPopulation`, `troopIncreaseRate`, `creditAdditionRate`, and
`scaleFleetUpkeep` for `PlayerType.Human` to be identical across all four
`Difficulty` values. Add new assertions there for any future difficulty-scaled
config touching humans.
