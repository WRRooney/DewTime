// Zod schemas for the `settings.*` IPC namespace.
//
// Uses a strict `discriminatedUnion('key', [...])` enforcing per-K value shape.
// Zod's discriminator picks the matching branch by the literal `key` value and
// validates `value` against that branch's schema in one parse — unknown keys and
// bad per-K values both reject with a single ValidationError; no handler-side
// narrowing needed.

import { z } from 'zod'

/**
 * Zod equivalent of the `SettingKey` union in src/shared/ipc.ts.
 * Keep this list in sync with that union — both are sources of truth at
 * different layers (TypeScript / runtime); divergence would let an invalid
 * key reach the SQLite settings table.
 */
export const SettingKeySchema = z.enum([
  'settings.week_start',
  'settings.dark_mode',
  'settings.auto_pause',
  'settings.widget_mode',
  'settings.auto_launch',
  'settings.always_on_top',
  'settings.auto_update',
  // Composite window geometry; the legacy four-scalar window.x|y|width|height
  // keys were never seeded and do not appear in this enum.
  'settings.window_geometry',
])
export type SettingKeyParsed = z.infer<typeof SettingKeySchema>

// Per-key value sub-schemas — exported individually so tests can target them
// directly when the discriminatedUnion's error message is too coarse.

/** week_start ∈ {0=Monday, 6=Sunday} — mirrors v1 SettingsService values exactly. */
export const WeekStartValueSchema = z.union([z.literal(0), z.literal(6)])

/** Boolean flag — used for dark_mode, auto_pause, auto_launch (same shape). */
export const BooleanValueSchema = z.boolean()

/** widget_mode ∈ enum — mirrors v1 SettingsService DEFAULTS. */
export const WidgetModeValueSchema = z.enum(['floating', 'windowed', 'tray'])

/**
 * Composite window geometry. `x`/`y` are integer-nullable (null encodes
 * "center on first launch"). `width`/`height` are positive integers —
 * Zod's `.int().positive()` rejects negatives, zeros, and floats in one shot.
 * `services/window-geometry.ts` applies a second clamp at apply time as
 * defense in depth.
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
 * against that branch's schema. Unknown keys and bad per-K values both reject
 * with ValidationError — no handler-side narrowing required.
 *
 * Branch coverage MUST stay in sync with `SettingKeySchema` enum members —
 * Zod's `discriminatedUnion` builder rejects at construction time if any
 * branch declares a `key` literal not in the enum, but it does NOT enforce
 * that every enum member has a branch.
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
    key: z.literal('settings.always_on_top'),
    value: BooleanValueSchema,
  }),
  z.object({
    key: z.literal('settings.auto_update'),
    value: BooleanValueSchema,
  }),
  z.object({
    key: z.literal('settings.window_geometry'),
    value: WindowGeometryValueSchema,
  }),
])
export type SetArgs = z.infer<typeof SetArgsSchema>

/**
 * `settings.list()` — no arguments. IPC channel is `settings.list`;
 * the main-side repo function keeps the `getAll` name (handler maps channel → repo function).
 */
export const ListArgsSchema = z.object({}).optional()
export type ListArgs = z.infer<typeof ListArgsSchema>
