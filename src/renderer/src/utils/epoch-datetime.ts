// src/renderer/src/utils/epoch-datetime.ts
// Pure functions: EpochSeconds ↔ <input type="datetime-local"> value string.
//
// A-18: calling the global millisecond clock (Date dot now) is FORBIDDEN here.
//   Only `new Date(epochSeconds * 1000)` and `new Date(value)` are used.
//   Static gate: grep for the forbidden expression returns 0 matches in this file.
//
// DATA-04: epoch values are always integer seconds; Math.floor(…/1000) prevents
//   millisecond leakage into the database. datetimeLocalToEpoch always returns
//   an integer or null — never a fractional value.
//
// BUG FIX (missing-seconds): epochToDatetimeLocal now returns YYYY-MM-DDTHH:mm:ss
//   (19 chars, with seconds) instead of YYYY-MM-DDTHH:mm (16 chars). The editor
//   datetime-local inputs also carry step="1" so browsers render the seconds field.
//   datetimeLocalToEpoch accepts both the old 16-char format and the new 19-char
//   format for backward compatibility (e.g. if a stored draft value has no seconds).
//
// Refs:
//   - 05-CONTEXT.md D-10 (local wall-clock; no timezone; no ms-clock call)
//   - 05-RESEARCH.md § Pattern 5 (epoch-datetime conversion)
//   - MDN <input type="datetime-local"> (value format YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss)

import type { EpochSeconds } from '@shared/time'

/**
 * Convert EpochSeconds to YYYY-MM-DDTHH:mm:ss for <input type="datetime-local">.
 * Uses local wall-clock (no Z suffix) — correct for a single-user desktop app.
 * Seconds are included so the editor can display and edit sub-minute precision.
 *
 * A-18: does NOT call the global millisecond clock.
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
 *
 * DATA-04: Math.floor(…/1000) — never leaks milliseconds into the DB.
 * A-18: does NOT call the global millisecond clock.
 */
export function datetimeLocalToEpoch(value: string): EpochSeconds | null {
  if (!value) return null
  const d = new Date(value) // local-time parse (no 'Z' suffix — V8/Chromium safe)
  if (isNaN(d.getTime())) return null
  return Math.floor(d.getTime() / 1000) as EpochSeconds
}
