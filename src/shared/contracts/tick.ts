// src/shared/contracts/tick.ts
// Zod schema for the `tick:update` one-way push channel payload.
//
// Channel literal: 'tick:update' (colon convention for one-way events, D-07).
// This contract is NOT validated by ipcMain.handle — tick is a one-way
// webContents.send (main → renderer), so there is no IPC validation gate on
// the receive side. The schema exists as the canonical source-of-truth for the
// payload shape and as the assertion source for tick.test.ts (plan 04-04) —
// the emit-side unit tests parse the payload against this schema to verify
// correctness.
//
// Refs:
//   - D-07: tick channel name, TickEventPayload shape (timerId + elapsedSeconds)
//   - D-08: cleanup-returning subscribe; preload bridge wraps ipcRenderer.on
//   - src/shared/ipc.ts TickEventPayload (one source of truth; this file
//     re-exports the type from there to avoid duplication)
import { z } from 'zod'
import type { TickEventPayload } from '../ipc'

/**
 * Zod schema mirroring `TickEventPayload` from `src/shared/ipc.ts` (D-07).
 *
 * - `timerId`: identifies which timer is currently ticking. Must be a positive
 *   integer (row PK from the `timers` table — zero or negative is invalid).
 * - `elapsedSeconds`: non-negative elapsed count. Main computes
 *   `Math.max(0, nowSeconds() - entry.start_timestamp)` before emitting; the
 *   `min(0)` constraint here enforces that invariant at the schema level.
 *   Negative elapsed is invalid (clock skew or bug — plan 04-04 clamps to 0).
 */
export const TickEventPayloadSchema = z.object({
  timerId: z.number().int().positive(),
  elapsedSeconds: z.number().int().min(0),
})

/**
 * Re-export `TickEventPayload` from `src/shared/ipc.ts` so consumers MAY
 * import either. One source of truth for the shape lives in ipc.ts; this
 * file's schema is the runtime validator for that shape.
 */
export type { TickEventPayload }
