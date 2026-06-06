// Typed get/set over the `settings` table. Values are JSON-encoded in the
// `value TEXT` column. Zod schemas at the IPC boundary validate key and value
// before reaching this layer; this layer trusts the caller.
// All SQL uses `?` placeholders to prevent SQL injection.

import type Database from 'better-sqlite3'
import { getDb } from '../database'
import { NotFoundError } from '@shared/errors'
import type { SettingKey, SettingValue } from '@shared/ipc'

let stmts: {
  get: Database.Statement<unknown[]>
  upsert: Database.Statement<unknown[]>
  list: Database.Statement<unknown[]>
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
 * keys; can occur for window geometry before the first save).
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
 * to render the full settings panel in one IPC round-trip.
 */
export function getAll(): Record<string, unknown> {
  const rows = getStmts().list.all() as Array<{ key: string; value: string }>
  const out: Record<string, unknown> = {}
  for (const r of rows) {
    out[r.key] = JSON.parse(r.value)
  }
  return out
}
