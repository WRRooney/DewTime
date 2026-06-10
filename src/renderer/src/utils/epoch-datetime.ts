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

// ---------------------------------------------------------------------------
// Human-facing display format: "m/d/yy h:mm:ss a"
//   m   — month, no leading zero (1–12)
//   d   — day, no leading zero (1–31)
//   yy  — 2-digit year
//   h   — 12-hour clock, no leading zero (1–12)
//   mm  — minutes, 2 digits
//   ss  — seconds, 2 digits
//   a   — lowercase meridiem (am/pm)
// Example: 2026-06-09 19:20:05 (local) → "6/9/26 7:20:05 pm"
// Used by the timestamp-editor text inputs in place of <input type=datetime-local>,
// which cannot render a custom format.
// ---------------------------------------------------------------------------

/** Format EpochSeconds as local wall-clock "m/d/yy h:mm:ss a". */
export function epochToDisplay(epochSeconds: EpochSeconds): string {
  const d = new Date(epochSeconds * 1000) // JS Date requires ms
  const month = d.getMonth() + 1
  const day = d.getDate()
  const yy = String(d.getFullYear() % 100).padStart(2, '0')
  const h24 = d.getHours()
  const meridiem = h24 < 12 ? 'am' : 'pm'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${month}/${day}/${yy} ${h12}:${mi}:${ss} ${meridiem}`
}

// Tolerant parser: seconds optional, case-insensitive meridiem, optional dots
// ("p.m."), flexible surrounding whitespace. 2-digit years map to 2000–2099.
const DISPLAY_RE =
  /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*$/i

/**
 * Parse "m/d/yy h:mm:ss a" (seconds optional) into EpochSeconds.
 * Returns null on empty/invalid input. Rejects out-of-range and overflow
 * dates (e.g. 2/31). Math.floor — never leaks milliseconds into the DB.
 */
export function displayToEpoch(value: string): EpochSeconds | null {
  if (!value) return null
  const m = DISPLAY_RE.exec(value)
  if (!m) return null
  // Groups 1–5 and 7 are always present when the regex matches; 6 (seconds)
  // is the only optional capture.
  const month = Number(m[1])
  const day = Number(m[2])
  const yearStr = m[3]!
  const year = yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr)
  let hour = Number(m[4])
  const min = Number(m[5])
  const sec = m[6] !== undefined ? Number(m[6]) : 0
  const isPM = m[7]!.toLowerCase() === 'p'

  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (hour < 1 || hour > 12) return null
  if (min > 59 || sec > 59) return null

  if (isPM && hour !== 12) hour += 12
  if (!isPM && hour === 12) hour = 0

  const d = new Date(year, month - 1, day, hour, min, sec)
  if (isNaN(d.getTime())) return null
  // Reject calendar overflow (e.g. day 31 in a 30-day month rolling forward).
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null
  }
  return Math.floor(d.getTime() / 1000) as EpochSeconds
}
