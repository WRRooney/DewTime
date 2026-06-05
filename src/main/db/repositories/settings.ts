// src/main/db/repositories/settings.ts
// Typed get/set over the `settings` table. Values are JSON-encoded in the
// `value TEXT` column — see 001_initial.sql for the seeded defaults and
// CONTEXT.md "Specific Ideas" on the JSON round-trip.
//
// All SQL uses `?` placeholders — T-01-04 mitigation.
//
// Trust model: Zod schemas in `src/shared/contracts/settings.ts` validate the
// `key` ∈ SettingKey AND the `value` shape per K BEFORE values reach this
// layer (D-15). Runtime trust here is fine — we cast via `as` only.
//
// Refs:
//   - CONTEXT.md D-09 (pure functions, lazy stmt cache)
//   - CONTEXT.md D-15 (Zod at the IPC boundary; this layer trusts the caller)
//   - 001_initial.sql (5 seeded defaults: week_start, dark_mode, auto_pause,
//     widget_mode, auto_launch — all JSON-encoded)
//   - timerz/services/settings_service.py (v1 SettingsService DEFAULTS dict)

import { getDb } from '../database'
import { NotFoundError } from '@shared/errors'
import type { SettingKey, SettingValue } from '@shared/ipc'

let stmts: {
  get: ReturnType<ReturnType<typeof getDb>['prepare']>
  upsert: ReturnType<ReturnType<typeof getDb>['prepare']>
  list: ReturnType<ReturnType<typeof getDb>['prepare']>
} | null = null

function getStmts() {
  if (stmts) return stmts
  const db = getDb()
  stmts = {
    get: db.prepare(`SELECT value FROM settings WHERE key = ?`),
    // INSERT OR REPLACE so we don't need separate insert/update paths.
    upsert: db.prepare(
      `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
    ),
    list: db.prepare(`SELECT key, value FROM settings`),
  }
  return stmts
}

/** Reset the prepared-statement cache. Called from tests between cases. */
export function resetStmtCache(): void {
  stmts = null
}

/**
 * Typed get. Returns the parsed JSON value cast to the K-dependent type.
 * Throws NotFoundError if the key has no row (shouldn't happen for seeded
 * keys; useful for window.* before the first window-position save).
 */
export function get<K extends SettingKey>(key: K): SettingValue<K> {
  const row = getStmts().get.get(key) as { value: string } | undefined
  if (!row) throw new NotFoundError(`settings key not found: ${key}`)
  return JSON.parse(row.value) as SettingValue<K>
}

/**
 * Typed set. JSON-encodes the value and upserts into the settings row.
 * The Zod schema at the IPC boundary already validated that `value` matches
 * `SettingValue<K>` — this layer trusts the caller.
 */
export function set<K extends SettingKey>(key: K, value: SettingValue<K>): void {
  getStmts().upsert.run(key, JSON.stringify(value))
}

/**
 * Return all settings as a key→parsed-value record. Used by the settings UI
 * (Phase 3) to render the full settings panel in one IPC round-trip.
 */
export function getAll(): Record<string, unknown> {
  const rows = getStmts().list.all() as Array<{ key: string; value: string }>
  const out: Record<string, unknown> = {}
  for (const r of rows) {
    out[r.key] = JSON.parse(r.value)
  }
  return out
}
