---
name: locale-updates
description: How to add, update, or rename locale strings in OpenFront's 39-language i18n system
---

# Locale Updates

## File layout

```
resources/lang/
├── en.json         Canonical source of truth — add all new keys here first
├── es.json
├── fr.json
├── de.json
├── pt-BR.json
├── ru.json
├── zh-CN.json
├── ja.json
├── ko.json
└── ... (30 more)
```

**Always add to `en.json` first.** Other languages are community-translated and will show
the English fallback until a translator submits a PR.

## JSON structure

The file is a flat-ish JSON object with dot-path-style nested keys. Top-level sections:

```json
{
  "lang": { "native_name": "English", "lang_code": "en", ... },
  "common": { "close": "Close", "cancel": "Cancel", ... },
  "main": { "create_lobby": "Create Lobby", "join": "Join", ... },
  "help_modal": { "hotkeys": "Hotkeys", ... },
  "unit_names": { "colony": "Colony", "spaceport": "Spaceport", ... },
  "events_display": { "attack_cancelled_retreat": "...", ... },
  "troubleshooting": { ... }
}
```

## Adding a new string

1. Open `resources/lang/en.json`.
2. Add the key under the appropriate top-level section:
   ```json
   "unit_names": {
     "scan_probe": "Scan Probe"
   }
   ```
3. Use the key in TypeScript via the translation helper. Search the codebase for how existing
   keys are accessed — typically via a `t()` function or `intl-messageformat`:
   ```typescript
   t("unit_names.scan_probe")
   // or
   mg.displayMessage("events_display.attack_cancelled_retreat", MessageType.ATTACK_CANCELLED, ...)
   ```

## `displayMessage()` keys

`game.displayMessage(key, type, playerID, targetID?, vars?)` emits a localized event message.
The `key` must match a string in `resources/lang/en.json`. Variables (e.g., `{population}`) are
interpolated by `intl-messageformat`.

Example from `AttackExecution.ts`:

```typescript
this.mg.displayMessage(
  "events_display.attack_cancelled_retreat",
  MessageType.ATTACK_CANCELLED,
  this._owner.id(),
  undefined,
  { population: renderPopulation(deaths) },
);
```

The locale string must contain `{population}` as a placeholder.

## `QuickChat.json`

Quick-chat message keys live separately in `resources/QuickChat.json`. The structure is an
array of objects `{ key, display }`. Add new quick-chat entries here, not in `lang/*.json`.
The `QuickChatIntent` (in `Schemas.ts`) validates the key against this file at runtime.

## Checking for missing translations

Run `npm run lint` — ESLint does not check locale files. Missing translations fall back to
`en.json` at runtime (via `intl-messageformat`). There is no automated missing-key check;
check the browser console for `[i18n]` warnings.

## Renaming a key

1. Search all `resources/lang/*.json` for the old key.
2. Rename in all 39 files (or just `en.json` if you're OK with broken fallback until translated).
3. Search `src/` for usages of the old key string and update them.

There is no compile-time check for locale key correctness — mismatches only surface at runtime.

## Translation system

The client loads locale files at startup via `src/client/shell/` (search for `TranslationSystem`
or `intl-messageformat`). The `TranslationSystem.test.ts` tests that the locale file loads and
key substitution works. Run it with:

```bash
npx vitest run tests/TranslationSystem.test.ts
```
