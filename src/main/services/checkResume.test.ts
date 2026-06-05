// src/main/services/checkResume.test.ts
// Boot-time `checkResume()` tests against :memory: SQLite. Five cases covering
// CRASH-03 (running-entry detection on boot) and CRASH-04 (crash-suspect
// classification when the heartbeat is stale) plus the clock-skew clamp guard
// (RESEARCH § Pitfall 5 / T-02-06). All cases manipulate the DB directly via
// the repository layer so the test does NOT depend on TimerService.start()
// auto-starting the heartbeat scheduler — checkResume only reads, never writes.
//
//   1. null when no running entry exists                         → CRASH-03 sentinel
//   2. CRASH-03 / ROADMAP #4 — clean resume (fresh heartbeat)
//   3. CRASH-04 / ROADMAP #5 — crash-suspect (stale heartbeat > 300s)
//   4. CRASH-04 — crash-suspect (no heartbeat row → fallback to start_timestamp)
//   5. T-02-06 clock-skew clamp — heartbeat in the future is treated as fresh
//      (beatAge clamped to 0) and a `log.warn('clock skew')` is emitted
//
// Refs:
//   - 02-04-PLAN.md Task 1 <behavior> + <action>
//   - 02-CONTEXT.md D-11 (ResumeResult shape), D-12 (CRASH_THRESHOLD_SECONDS = 300),
//     D-13 (suspectedEnd fallback to start_timestamp)
//   - 02-RESEARCH.md § "Pattern 3 — checkResume" (lines 362-425)
//   - 02-RESEARCH.md § Pitfall 5 — clamp beatAge to 0 + log.warn on clock skew
//   - 02-RESEARCH.md § Pitfall 6 — restoreAllMocks for electron-log spy hygiene

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// CRITICAL: `vi.mock('electron', ...)` hoisted above imports — timer.ts
// transitively pulls in @main/log → electron-log which would load native
// Electron. Mock keeps the test in pure Node (RESEARCH § Pitfall 6 + D-10).
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used-with-:memory:' },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

import { initDb, closeDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import {
  create as createTimer,
  resetStmtCache as resetTimers,
} from '@main/db/repositories/timers'
import {
  start as startEntry,
  resetStmtCache as resetTimeEntries,
} from '@main/db/repositories/timeEntries'
import {
  write as writeHeartbeatRow,
  resetStmtCache as resetHeartbeat,
} from '@main/db/repositories/heartbeat'
import { resetForTests as resetHeartbeatService } from '@main/services/heartbeat'
import * as timerService from '@main/services/timer'
import { nowSeconds, type EpochSeconds } from '@shared/time'
import log from '@main/log'

describe('TimerService.checkResume — boot-time crash classification', () => {
  beforeEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
    resetHeartbeatService()
    timerService.resetForTests()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetHeartbeatService()
    timerService.resetForTests()
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
  })

  // Test 1 — null when no running entry exists (the sentinel case)
  it('returns null when no running entry exists; cache is populated to null', () => {
    expect(timerService.checkResume()).toBeNull()
    // getCachedResumeResult must NOT re-run (and thus log error) — the cache
    // was just populated to `null` (not `undefined`) by the call above.
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    expect(timerService.getCachedResumeResult()).toBeNull()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  // Test 2 — CRASH-03 / ROADMAP #4 — clean resume (fresh heartbeat)
  it('CRASH-03 / ROADMAP #4: returns running entry on clean resume (fresh heartbeat)', () => {
    // Arrange: a running entry + a fresh heartbeat (beat at nowSeconds() ⇒
    // beatAge ≈ 0, well under CRASH_THRESHOLD_SECONDS = 300).
    const timer = createTimer({ projectId: null, description: 'crash-03' })
    const entry = startEntry(timer.id)
    writeHeartbeatRow(nowSeconds(), entry.id)

    // Act
    const result = timerService.checkResume()

    // Assert: ResumeResult shape per D-11
    expect(result).not.toBeNull()
    expect(result!.entry.id).toBe(entry.id)
    expect(result!.entry.timer_id).toBe(timer.id)
    expect(result!.isCleanResume).toBe(true)
    expect(result!.suspectedEnd).toBeNull()
  })

  // Test 3 — CRASH-04 / ROADMAP #5 — crash-suspect when heartbeat age > 300s
  it('CRASH-04 / ROADMAP #5: classifies crash-suspect when heartbeat age > CRASH_THRESHOLD_SECONDS', () => {
    // Arrange: a running entry + a STALE heartbeat 600s old (well over the
    // 300s threshold from D-12). last_beat is the older epoch second; the
    // suspected end-of-session is that last_beat value per D-13.
    const timer = createTimer({ projectId: null, description: 'crash-04-stale' })
    const entry = startEntry(timer.id)
    const staleBeatAt = ((nowSeconds() as number) - 600) as EpochSeconds
    writeHeartbeatRow(staleBeatAt, entry.id)

    // Spy on log.warn — implementation MUST surface the crash-suspect via
    // electron-log at warn level (D-20). We assert the warn message contains
    // the literal token 'crash-suspect' so future log rewordings stay searchable.
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})

    // Act
    const result = timerService.checkResume()

    // Assert: crash-suspect classification per D-13
    expect(result).not.toBeNull()
    expect(result!.entry.id).toBe(entry.id)
    expect(result!.isCleanResume).toBe(false)
    // suspectedEnd should be the stale heartbeat's last_beat — D-13 first branch.
    expect(result!.suspectedEnd).toBe(staleBeatAt)

    // The warn message must mention crash-suspect (D-20 surface).
    expect(warnSpy).toHaveBeenCalled()
    const warnMessages = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(warnMessages.some((m) => m.includes('crash-suspect'))).toBe(true)
  })

  // Test 4 — CRASH-04 — crash-suspect with no heartbeat row → fallback to
  // entry.start_timestamp (D-13 second branch).
  it('CRASH-04: classifies crash-suspect when running entry exists but no heartbeat row (fallback to start_timestamp)', () => {
    // Arrange: running entry, NO heartbeat row at all (the running entry was
    // created without the heartbeat ever ticking — e.g., the OS killed the
    // process within the first 60 seconds of TimerService.start()).
    const timer = createTimer({ projectId: null, description: 'crash-04-no-beat' })
    const entry = startEntry(timer.id)

    // Act
    const result = timerService.checkResume()

    // Assert: per D-13, with no heartbeat row, suspectedEnd falls back to the
    // running entry's start_timestamp. beatAge is treated as Infinity so the
    // crash-suspect branch fires unconditionally.
    expect(result).not.toBeNull()
    expect(result!.entry.id).toBe(entry.id)
    expect(result!.isCleanResume).toBe(false)
    expect(result!.suspectedEnd).toBe(entry.start_timestamp)
  })

  // Test 5 — T-02-06 clock-skew clamp + log.warn
  // RESEARCH § Pitfall 5: when last_beat > nowSeconds() (clock jumped
  // backward), naive `now - last_beat` is negative. Treating that as "fresh"
  // is the SAFE interpretation (don't false-positive crash on clock skew),
  // but the implementation MUST log.warn so post-mortem analysis can detect
  // time-tampering after the fact.
  it('T-02-06: clamps negative beatAge to 0 (clock skew) and logs warn for future-dated heartbeat', () => {
    const timer = createTimer({ projectId: null, description: 'clock-skew' })
    const entry = startEntry(timer.id)
    // Write a heartbeat 60s in the FUTURE (clock skew — NTP correction, dual-
    // boot timezone drift, manual clock change). beatAge would be -60s without
    // the clamp; the clamp turns it into 0 → clean-resume classification.
    const futureBeatAt = ((nowSeconds() as number) + 60) as EpochSeconds
    writeHeartbeatRow(futureBeatAt, entry.id)

    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})

    const result = timerService.checkResume()

    // Assert: clamp prevents the future-dated heartbeat from being classified
    // as crash-suspect (would happen if beatAge was treated as +Infinity or
    // any large positive value). With the clamp, beatAge becomes 0 → fresh.
    expect(result).not.toBeNull()
    expect(result!.entry.id).toBe(entry.id)
    expect(result!.isCleanResume).toBe(true)
    expect(result!.suspectedEnd).toBeNull()

    // The warn message MUST surface the clock-skew event so a future operator
    // can grep main.log for unexpected NTP jumps. We assert on the literal
    // token 'clock skew' (RESEARCH § Pitfall 5 wording).
    expect(warnSpy).toHaveBeenCalled()
    const warnMessages = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(warnMessages.some((m) => m.includes('clock skew'))).toBe(true)
  })
})
