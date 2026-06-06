// Billing-style quarter-hour rounding + decimal-hours formatting for the
// duration copy-button (Ignition v0 copied a floating-point hours total like
// "22.75" / "0.00").
//
// Rounding rule (per product spec): round to the nearest quarter hour, but
// "if 5 minutes past then round up". Interpreted per 15-minute block: take the
// remainder past the lower quarter boundary; if it is >= 5 minutes, round UP to
// the next quarter, otherwise round DOWN to the current quarter.
//
//   1:04 (4m past :00)  → round down → 1.00
//   1:05 (5m past :00)  → round up   → 1.25
//   1:18 (3m past :15)  → round down → 1.25
//   1:20 (5m past :15)  → round up   → 1.50
//  22:48 (3m past :45)  → round down → 22.75   (matches Ignition's "22.75")
//
// Dependency-free, pure. Negative/zero clamp to 0 (display never bills negative
// time — mirrors formatDuration's clamp).

const QUARTER_SECONDS = 15 * 60 // 900
const ROUND_UP_THRESHOLD_SECONDS = 5 * 60 // 300

/**
 * Rounds an elapsed-seconds count to a quarter-hour decimal-hours value using
 * the "5-minutes-past rounds up" rule. Result is a multiple of 0.25.
 *
 * @param seconds elapsed seconds (may be negative — clamps to 0)
 * @returns decimal hours, a multiple of 0.25 (e.g. 1.25)
 */
export function roundToQuarterHours(seconds: number): number {
  if (seconds <= 0) return 0
  const remainder = seconds % QUARTER_SECONDS
  let rounded = seconds - remainder // floor to the quarter boundary
  if (remainder >= ROUND_UP_THRESHOLD_SECONDS) {
    rounded += QUARTER_SECONDS
  }
  return rounded / 3600
}

/**
 * Formats elapsed seconds as the clipboard-ready decimal-hours string: the
 * quarter-hour-rounded value with two decimal places (always one of
 * .00/.25/.50/.75).
 *
 * @param seconds elapsed seconds
 * @returns e.g. "0.00", "1.25", "22.75"
 */
export function formatDecimalHours(seconds: number): string {
  return roundToQuarterHours(seconds).toFixed(2)
}
