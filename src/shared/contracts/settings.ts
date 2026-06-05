// src/shared/contracts/settings.ts
// Zod schemas for the `settings.*` IPC namespace. Plan 03-03 wires the
// handlers; plan 03-01 (this file) settles the contract: a strict
// `discriminatedUnion('key', [...])` enforcing per-K value shape, replacing
// Phase 1's permissive `{ key, value: z.unknown() }` placeholder.
//
// Why discriminatedUnion (03-CONTEXT D-21):
//   Zod's discriminator picks the matching branch by the literal `key`
//   value and validates the sibling `value` against THAT branch's schema in
//   one parse. Unknown keys (T-03-02 spoofing) and per-K bad values (T-03-01
//   tampering, T-03-03 bad bounds) both reject with a single ValidationError.
//   No handler-side narrowing needed — the schema is the gate.
//
// Refs:
//   - 03-CONTEXT.md D-09 (composite settings.window_geometry; nullable x/y)
//   - 03-CONTEXT.md D-18 (`settings.list` channel name; helper-type rename)
//   - 03-CONTEXT.md D-21 (discriminatedUnion shape; per-K value schemas)
//   - 03-RESEARCH.md § Pattern 7 + § Pattern 11 (literal Zod shape)
//   - src/shared/ipc.ts (SettingKey union + SettingValue<K> + WindowGeometry)

import { z } from 'zod'

/**
 * Zod equivalent of the `SettingKey` union in src/shared/ipc.ts.
 * Keep this list in sync with that union — both are sources of truth at
 * different layers (TypeScript / runtime); divergence would let an invalid
 * key reach the SQLite settings table (T-03-02 spoofing mitigation).
 */
export const SettingKeySchema = z.enum([
  'settings.week_start',
  'settings.dark_mode',
  'settings.auto_pause',
  'settings.widget_mode',
  'settings.auto_launch',
  // Phase 3 (D-09) — composite window geometry; replaces never-seeded
  // legacy window.x|y|width|height keys (those were never in this enum
  // post plan 03-01).
  'settings.window_geometry',
])
export type SettingKeyParsed = z.infer<typeof SettingKeySchema>

// ---------------------------------------------------------------------------
// Per-key value sub-schemas (03-RESEARCH § Pattern 7)
// Exported individually so plan 03-03's settings.test.ts can target them
// directly when the discriminatedUnion's error message is too coarse.
// ---------------------------------------------------------------------------

/** week_start ∈ {0=Monday, 6=Sunday} — mirrors v1 SettingsService values exactly. */
export const WeekStartValueSchema = z.union([z.literal(0), z.literal(6)])

/** Boolean flag — used for dark_mode, auto_pause, auto_launch (same shape). */
export const BooleanValueSchema = z.boolean()

/** widget_mode ∈ enum — mirrors v1 SettingsService DEFAULTS. */
export const WidgetModeValueSchema = z.enum(['floating', 'windowed', 'tray'])

/**
 * Composite window geometry (03-CONTEXT D-09). `x`/`y` are integer-nullable
 * (the null sentinel encodes "center on first launch"). `width`/`height` are
 * positive integers — Zod's `.int().positive()` rejects negatives, zeros, and
 * floats in one shot. Plan 03-02's services/window-geometry.ts applies a
 * second clamp at apply time (defense in depth against T-03-03 bad bounds).
 */
export const WindowGeometryValueSchema = z.object({
  x: z.number().int().nullable(),
  y: z.number().int().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

/** `settings.get(key)`. */
export const GetArgsSchema = z.object({
  key: SettingKeySchema,
})
export type GetArgs = z.infer<typeof GetArgsSchema>

/**
 * `settings.set(key, value)` — strict K-discriminated union.
 *
 * Each branch is a `z.object({ key: z.literal(<K>), value: <ValueSchema> })`.
 * Zod selects the branch by the literal `key` value and validates `value`
 * against that branch's schema. Unknown keys (T-03-02) and bad per-K values
 * (T-03-01, T-03-03) both reject with ValidationError — no handler-side
 * narrowing required (03-CONTEXT D-21).
 *
 * Branch coverage MUST stay in sync with `SettingKeySchema` enum members —
 * Zod's `discriminatedUnion` builder rejects at construction time if any
 * branch declares a `key` literal not in the enum, but it does NOT enforce
 * that every enum member has a branch. The two grep gates in
 * 03-VALIDATION.md (CONTRACT-WG) catch divergence.
 */
export const SetArgsSchema = z.discriminatedUnion('key', [
  z.object({
    key: z.literal('settings.week_start'),
    value: WeekStartValueSchema,
  }),
  z.object({
    key: z.literal('settings.dark_mode'),
    value: BooleanValueSchema,
  }),
  z.object({
    key: z.literal('settings.auto_pause'),
    value: BooleanValueSchema,
  }),
  z.object({
    key: z.literal('settings.widget_mode'),
    value: WidgetModeValueSchema,
  }),
  z.object({
    key: z.literal('settings.auto_launch'),
    value: BooleanValueSchema,
  }),
  z.object({
    key: z.literal('settings.window_geometry'),
    value: WindowGeometryValueSchema,
  }),
])
export type SetArgs = z.infer<typeof SetArgsSchema>

/**
 * `settings.list()` — no arguments. Renamed from `GetAllArgsSchema` per
 * 03-CONTEXT D-18 (IPC channel is `settings.list`; renderer-side API method
 * is `SettingsApi.list()`). Repo function on the main side intentionally
 * keeps the `getAll` name (handler maps channel → repo function).
 */
export const ListArgsSchema = z.object({}).optional()
export type ListArgs = z.infer<typeof ListArgsSchema>
