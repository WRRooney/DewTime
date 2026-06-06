// Zod schema for the `tick:update` one-way push channel payload.
//
// NOT validated by ipcMain.handle — tick is a one-way webContents.send
// (main → renderer). The schema is the canonical source-of-truth for the
// payload shape; emit-side unit tests parse against it to verify correctness.
import { z } from 'zod'
import type { TickEventPayload } from '../ipc'

/**
 * Zod schema mirroring `TickEventPayload` from `src/shared/ipc.ts`.
 *
 * - `timerId`: row PK from the `timers` table — must be a positive integer.
 * - `elapsedSeconds`: non-negative elapsed count. Main computes
 *   `Math.max(0, nowSeconds() - entry.start_timestamp)` before emitting;
 *   `min(0)` enforces that invariant at the schema level.
 */
export const TickEventPayloadSchema = z.object({
  timerId: z.number().int().positive(),
  elapsedSeconds: z.number().int().min(0),
})

/**
 * Re-export `TickEventPayload` from `src/shared/ipc.ts` so consumers may
 * import either. The shape's single source of truth lives in ipc.ts.
 */
export type { TickEventPayload }
