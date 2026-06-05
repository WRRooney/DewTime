// src/main/ipc/settings.ts
// IPC handlers for the `settings.*` namespace. Three handlers (`get`, `set`,
// `list`) delegate DIRECTLY to the `@main/db/repositories/settings` module
// — there is no settings service layer, by design.
//
// D-28 SERVICE-BYPASS EXCEPTION (documented intentional bypass):
//   Phase 2's TIME-07 / threat-model T-02-03 mandates that every IPC handler
//   route state-changing work through a `services/*` module so the canonical
//   FSM transaction (`db.transaction(fn)`) wraps the write. Settings has NO
//   FSM — it is a pure read/write namespace over a single-row-per-key table
//   with JSON-encoded values. The same exception applies as Phase 2's
//   `listByTimer` handler (pure read, no FSM, direct repo call).
//
//   The plan's static gate asserts that NO services-module import exists in
//   this file (count of services-namespace imports MUST be 0) — there is no
//   service to import, and any future contributor adding one without
//   updating CONTEXT D-28 should be caught by CI. A companion gate asserts
//   this comment block stays present (`grep -c "service-bypass\|D-28"
//   src/main/ipc/settings.ts` MUST return ≥ 1).
//
// ZOD AT THE BOUNDARY (D-19 + Phase 1 D-15 carry-forward):
//   Each handler runs `<Schema>.safeParse(args)` via the shared `handler()`
//   factory imported from `./system`. On parse failure the factory throws
//   `ValidationError` whose `.message` is `[VALIDATION] ...` — the prefix
//   preload's `reviveError` matches against to rebuild the typed subclass on
//   the renderer side (Phase 1 D-14 refinement in src/shared/errors.ts).
//
//   The `SetArgsSchema` is a `z.discriminatedUnion('key', [...])` — Zod
//   picks the branch by the literal `key` value and validates the sibling
//   `value` against THAT branch's schema in a single safeParse(). Unknown
//   keys (T-03-02 spoofing) and per-K bad values (T-03-01 week_start range,
//   T-03-03 bad window bounds) both reject at the IPC boundary with one
//   error, no handler-side narrowing.
//
// CHANNEL NAMES (D-13 from Phase 1 + D-19 here):
//   Dotted strings — `ipcMain.handle('settings.get', ...)` must match the
//   `invokeWrapped('settings.get', ...)` literal in `src/preload/index.ts`
//   character-for-character. Mismatch → "No handler registered for X" at
//   invoke time (T-01-03 channel whitelist via registration).
//
// D-18 / D-20 / D-21 wiring:
//   - D-18: three handlers (get, set, list); `settings.list` channel name
//     maps to the repo's `getAll()` function (the repo function intentionally
//     kept its `getAll` name — see plan 03-01 SUMMARY decision #4).
//   - D-20: `src/main/ipc/index.ts` `registerAllHandlers()` calls
//     `registerSettingsHandlers()` alongside the existing system + timeEntries
//     registrations; `src/preload/index.ts` replaces three notImpl stubs
//     with real `invokeWrapped` calls matching the channel strings below.
//   - D-21: the discriminated-union schema is the SINGLE gate against
//     malformed renderer payloads — no handler-side narrowing, no second
//     pass at the repository layer.
//
// Refs:
//   - 03-03-PLAN.md Task 2 <action>
//   - 03-CONTEXT.md D-18, D-19, D-20, D-21, D-28 (service-bypass exception)
//   - 03-RESEARCH.md § Pattern 6 (literal handler shape) + § Pattern 11
//     (discriminated union behavior at the boundary)
//   - src/main/ipc/timeEntries.ts (Phase 2 IPC handler shape — mirrored here)
//   - src/main/ipc/system.ts (the canonical `handler()` factory)

import { ipcMain } from 'electron'
import * as settingsRepo from '@main/db/repositories/settings'
import { handler } from './system'
import {
  GetArgsSchema,
  SetArgsSchema,
  ListArgsSchema,
} from '@shared/contracts/settings'
import type { SettingKey, SettingValue } from '@shared/ipc'

/**
 * `settings.get(key)` — return the parsed JSON value for the given setting key.
 *
 * The Zod `GetArgsSchema` (`{ key: SettingKeySchema }`) rejects unknown keys
 * with `ValidationError` BEFORE the handler body runs (T-03-02 mitigation).
 * The repository's `get<K>` throws `NotFoundError` if the row is absent —
 * shouldn't happen for any seeded key, but the prefix-encoded message
 * survives IPC so the renderer sees a typed NotFoundError on the rare miss.
 *
 * D-28 SERVICE-BYPASS: delegates directly to `settingsRepo.get(key)`. There
 * is no settings service layer — settings is pure read/write with no FSM.
 */
export const handleGet = handler(GetArgsSchema, async ({ key }) => {
  return settingsRepo.get(key) as SettingValue<SettingKey>
})

/**
 * `settings.set(key, value)` — JSON-encode `value` and upsert into the
 * settings row keyed by `key`.
 *
 * `SetArgsSchema` is a `z.discriminatedUnion('key', [...])` covering every
 * known SettingKey. Zod selects the matching branch by the literal `key`
 * value and validates `value` against THAT branch's schema (T-03-01 +
 * T-03-03 mitigations in one pass). The cast at the repo call site narrows
 * the K-dependent conditional `SettingValue<K>` — Zod has already validated
 * the JS shape, and the cast is the price of bridging the discriminated
 * union's `(key, value)` tuple to the per-K conditional type.
 *
 * D-28 SERVICE-BYPASS: delegates directly to `settingsRepo.set(key, value)`.
 */
export const handleSet = handler(SetArgsSchema, async (args) => {
  settingsRepo.set(
    args.key,
    args.value as SettingValue<typeof args.key>,
  )
})

/**
 * `settings.list()` — return every settings row as a `Record<SettingKey,
 * unknown>` with JSON-parsed values. Used by the renderer's
 * `SettingsContext` (plan 03-05) to render the settings dialog with a
 * single IPC round-trip on app mount.
 *
 * D-28 SERVICE-BYPASS: delegates directly to `settingsRepo.getAll()`. The
 * channel name is `settings.list` per D-18; the repo function intentionally
 * keeps its `getAll` name (plan 03-01 SUMMARY decision #4 — the channel ↔
 * function asymmetry is documented there).
 *
 * The `ListArgsSchema` is `z.object({}).optional()` — `undefined` or `{}`
 * both parse cleanly, so the renderer's `invokeWrapped('settings.list', {})`
 * call works without ceremony.
 */
export const handleList = handler(ListArgsSchema, async () => {
  return settingsRepo.getAll() as Record<SettingKey, unknown>
})

/**
 * Register the `settings.*` IPC channels with `ipcMain`. Called from
 * `registerAllHandlers()` in `./index.ts` AFTER `initDb()` + `runMigrations()`
 * have completed (the seeded settings rows must exist before the first
 * `settings.list` call lands).
 *
 * Channel names are the literal dotted strings — they must match the strings
 * passed to `invokeWrapped(...)` in `src/preload/index.ts` character-for-
 * character (T-01-03 channel whitelist via registration; Electron throws
 * "No handler registered for X" on a typo).
 *
 * The `_evt` parameter (Electron's IpcMainInvokeEvent) is intentionally
 * unused — handler bodies must not depend on which renderer made the call
 * (single-window assumption inherited from Phase 1).
 *
 * @param ipc — injectable for tests; defaults to the real `ipcMain`.
 */
export function registerSettingsHandlers(
  ipc: typeof ipcMain = ipcMain,
): void {
  ipc.handle('settings.get', (_evt, args) => handleGet(args))
  ipc.handle('settings.set', (_evt, args) => handleSet(args))
  ipc.handle('settings.list', (_evt, args) => handleList(args))
}
