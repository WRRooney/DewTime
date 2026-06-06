// Pure functions: EpochSeconds ↔ <input type="datetime-local"> value string.
//
// Date.now() is FORBIDDEN here — only `new Date(epochSeconds * 1000)` and
// `new Date(value)` are used. Epoch values are always integer seconds;
// Math.floor(…/1000) prevents millisecond leakage into the database.
//
// epochToDatetimeLocal returns YYYY-MM-DDTHH:mm:ss (with seconds); editor
// inputs carry step="1" so browsers render the seconds field.
// datetimeLocalToEpoch accepts both the 16-char (no seconds) and 19-char
// (with seconds) formats for backward compatibility.

import type { EpochSeconds } from '@shared/time'

/**
 * Convert EpochSeconds to YYYY-MM-DDTHH:mm:ss for <input type="datetime-local">.
 * Uses local wall-clock (no Z suffix) — correct for a single-user desktop app.
 * Seconds are included so the editor can display and edit sub-minute precision.
 */
export function epochToDatetimeLocal(epochSeconds: EpochSeconds): string {
  const d = new Date(epochSeconds * 1000) // JS Date requires ms
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`
}

/**
 * Parse YYYY-MM-DDTHH:mm:ss (or legacy YYYY-MM-DDTHH:mm) from
 * <input type="datetime-local"> into EpochSeconds.
 * Returns null if empty or invalid.
 * Math.floor(…/1000) — never leaks milliseconds into the DB.
 */
export function datetimeLocalToEpoch(value: string): EpochSeconds | null {
  if (!value) return null
  const d = new Date(value) // local-time parse (no 'Z' suffix — V8/Chromium safe)
  if (isNaN(d.getTime())) return null
  return Math.floor(d.getTime() / 1000) as EpochSeconds
}
