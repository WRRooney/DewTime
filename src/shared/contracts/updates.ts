// Zod contract for the `updates.*` IPC namespace.
// This is an ACTION/EVENT channel — not a persisted setting. Use `updates.check`
// to trigger an on-demand update check; the result is a status snapshot only.
// The native approval dialog and download lifecycle are driven entirely by main.

import { z } from 'zod'

/**
 * `updates.check()` — no args. Mirrors the pattern of ListArgsSchema in other
 * contracts: an optional empty object so the handler is consistent with the
 * `handler()` factory's Zod-validation shell.
 */
export const CheckUpdatesArgsSchema = z.object({}).optional()
export type CheckUpdatesArgs = z.infer<typeof CheckUpdatesArgsSchema>

/**
 * Union of statuses returned by `updates.check`.
 *   - 'checking'    — renderer-only transient state before the await resolves.
 *   - 'up-to-date'  — no newer version found.
 *   - 'available'   — a newer version exists; native approval dialog was shown.
 *   - 'error'       — check failed (offline, rate-limit, etc.) — non-fatal.
 *   - 'unsupported' — running unpackaged (dev); no update metadata available.
 */
export type UpdateStatus = 'checking' | 'up-to-date' | 'available' | 'error' | 'unsupported'

/** Result returned by `updates.check` IPC handler (and `checkForUpdatesManual`). */
export interface UpdateCheckResult {
  status: UpdateStatus
  /** Present only when status is 'available'. */
  version?: string
}
