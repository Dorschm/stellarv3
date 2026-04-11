---
name: add-unit-type
description: Step-by-step guide for adding a new UnitType to OpenFront (enum, info, execution, UI)
---

# Adding a New UnitType

## Overview of the pipeline

Adding a new unit touches 6+ files. The `UnitType` enum lives in `src/core/game/Game.ts`
alongside `UnitInfo`, `UnitParamsMap`, and the `Structures`/`BuildMenus`/`PlayerBuildable` groups.
Each unit type needs an Execution class and usually a `BuildUnitIntent` route.

## Step 1 — Add the enum value to `UnitType`

File: `src/core/game/Game.ts` (~line 226)

```typescript
export enum UnitType {
  // ... existing values ...
  ScanProbe = "Scan Probe", // display name used in UI
}
```

## Step 2 — Add to the appropriate group constant

Same file, around line 259–298. Choose the right group(s):

```typescript
// If it's a structure (stationary, built on a tile):
export const Structures = unitTypeGroup([
  ...existing...,
  UnitType.ScanProbe,
] as const);

// If it's buildable from the Build Menu:
export const BuildMenus = unitTypeGroup([
  ...existing...,
  UnitType.ScanProbe,
] as const);

// If it's buildable by a player (includes BuildMenus + assault shuttles):
export const PlayerBuildable = unitTypeGroup([
  ...existing...,
  UnitType.ScanProbe,
] as const);

// If it's a nuke-class weapon:
export const Nukes = unitTypeGroup([...]);

// If it's a buildable attack (shown in build menu under attacks):
export const BuildableAttacks = unitTypeGroup([...]);
```

## Step 3 — Add UnitParams entry

Same file, in `UnitParamsMap` (~line 310). Every UnitType must have an entry:

```typescript
[UnitType.ScanProbe]: {
  targetTile: TileRef;
  // or Record<string, never> if the unit takes no params
};
```

## Step 4 — Add UnitInfo in `DefaultConfig.ts`

File: `src/core/configuration/DefaultConfig.ts`

Find the `unitInfo(type: UnitType): UnitInfo` method (or similar). Add a case:

```typescript
case UnitType.ScanProbe:
  return {
    cost: (game, player) => BigInt(500),  // Credits is bigint
    maxHealth: 50,
    constructionDuration: 10,  // ticks; omit for instant
    upgradable: false,
  };
```

## Step 5 — Create the Execution class

Create `src/core/execution/ScanProbeExecution.ts`. Follow the Execution pattern (see
`add-intent-and-execution.md`). For structures, mirror `ColonyExecution.ts` or
`SpaceportExecution.ts`. For mobile units, mirror `BattlecruiserExecution.ts`.

## Step 6 — Wire up in `ConstructionExecution.ts`

File: `src/core/execution/ConstructionExecution.ts`

Add a case to `completeConstruction()` (the `switch` around line 141):

```typescript
case UnitType.ScanProbe:
  this.mg.addExecution(new ScanProbeExecution(this.structure!));
  break;
```

Add a case to `isStructure()` if it is a stationary structure:

```typescript
case UnitType.ScanProbe:
  return true;
```

## Step 7 — Add to localization strings

File: `resources/lang/en.json` (canonical; other languages will lag behind)

Find the unit name section and add:

```json
"unit_names": {
  "scan_probe": "Scan Probe"
}
```

Check `src/client/hud/BuildMenu.tsx` (or equivalent) for how unit names are looked up — may
use `UnitType` string value directly, or a locale key.

## Step 8 — Handle in the client Build Menu

File: `src/client/hud/BuildMenu.tsx` (or `src/client/hud/RadialMenu.tsx`)

If the unit should appear in the Build Menu, `BuildMenus.has(UnitType.ScanProbe)` will
automatically include it once you added it to `BuildMenus` in Step 2. Verify the cost display
and tooltip render correctly.

## Step 9 — Add a test

```typescript
import { setup } from "./util/Setup";
import { constructionExecution } from "./util/utils";

it("builds a scan probe", async () => {
  const game = await setup("ocean_and_land", {
    infiniteCredits: true,
    instantBuild: true,
  });
  // spawn player, then:
  game.addExecution(constructionExecution(player, UnitType.ScanProbe, tile));
  game.executeNextTick();
  expect(player.units(UnitType.ScanProbe)).toHaveLength(1);
});
```

`constructionExecution()` helper is in `tests/util/utils.ts`.

## Files that must be updated together

| File                                          | Change                                            |
| --------------------------------------------- | ------------------------------------------------- |
| `src/core/game/Game.ts`                       | `UnitType` enum, `UnitParamsMap`, group constants |
| `src/core/configuration/DefaultConfig.ts`     | `unitInfo()` case                                 |
| `src/core/execution/ScanProbeExecution.ts`    | New Execution class                               |
| `src/core/execution/ConstructionExecution.ts` | `completeConstruction()` + `isStructure()`        |
| `resources/lang/en.json`                      | Display name                                      |
| `tests/`                                      | Unit test                                         |

## Notes

- Weapons (nukes/plasma bolts) bypass `ConstructionExecution.isStructure()` — they're spawned
  directly via `NukeExecution` or equivalent. See `ConstructionExecution.completeConstruction()`
  for the non-structure path.
- Battlecruiser slot hosting (DefenseStation + OrbitalStrikePlatform) is implemented in
  `ConstructionExecution.findHostBattlecruiser()`. If your structure can be hosted, add it there.
- The `upgradable: true` flag in `UnitInfo` hooks into `UpgradeStructureExecution.ts`.
