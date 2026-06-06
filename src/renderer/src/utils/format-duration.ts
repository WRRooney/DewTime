// Pure function: HH:MM:SS display formatting.
//
// Rules (in priority order):
//   1. seconds < 0  → clamp to '00:00:00' (negative offsets are valid; display never shows negative)
//   2. h < 100      → zero-padded HH:MM:SS (the common case)
//   3. h >= 100     → hours unpadded + zero-padded MM:SS (e.g. 360_000 s → '100:00:00')
//   4. Output: digits + colons only — no 'h'/'m'/'s' suffix, no spaces
//
// Dependency-free. Math.floor (not Math.trunc) for deterministic behaviour
// across negative-adjacent inputs (post-clamp).

/**
 * Formats an elapsed-seconds count as a colon-separated duration string.
 * Hours are zero-padded to 2 digits when < 100; unpadded when >= 100.
 * Minutes and seconds are always zero-padded to 2 digits.
 *
 * @param seconds - Total elapsed seconds. May be negative (clamps to '00:00:00').
 *
 * @example
 * formatDuration(-1)         // '00:00:00'  (clamp)
 * formatDuration(0)          // '00:00:00'
 * formatDuration(1)          // '00:00:01'
 * formatDuration(3661)       // '01:01:01'
 * formatDuration(360_000)    // '100:00:00' (hours unpadded)
 * formatDuration(4_444_567)  // '1234:56:07'
 */
export function formatDuration(seconds: number): string {
  // Rule 1: clamp negative values
  if (seconds < 0) {
    return '00:00:00'
  }

  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  const mm = m.toString().padStart(2, '0')
  const ss = s.toString().padStart(2, '0')

  if (h < 100) {
    // Rule 2: zero-padded HH:MM:SS
    const hh = h.toString().padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  } else {
    // Rule 3: hours unpadded + padded MM:SS
    return `${h.toString()}:${mm}:${ss}`
  }
}
