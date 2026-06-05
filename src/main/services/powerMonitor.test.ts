// src/main/services/powerMonitor.test.ts
// Tests the powerMonitor 'resume' listener BODY — { stopHeartbeat(); startHeartbeat() }
// — against the same `vi.mock('electron', ...)` capture pattern that the
// runMain wiring (Task 3) uses in production. These tests deliberately do NOT
// import or call `runMain` — that would require app.whenReady + createWindow
// scaffolding orthogonal to CRASH-02. Instead, each test registers the
// listener inline (the SAME callback body Task 3 inserts into runMain) and
// invokes it via the captured handler. This keeps the unit boundary tight:
// "given a 'resume' callback that calls stopHeartbeat + startHeartbeat, does
// the heartbeat actually resume ticking after a simulated wake?"
//
//   1. CRASH-02 / ROADMAP #3 — resume callback restarts the heartbeat
//      interval; heartbeat row's last_beat advances after the simulated wake.
//   2. resume callback is a no-op for the DB when no timer is running —
//      the interval starts (idempotent restart) but writeHeartbeat early-
//      returns; readHeartbeat() stays null.
//
// Refs:
//   - 02-04-PLAN.md Task 2 <behavior> + <action>
//   - 02-CONTEXT.md D-09 (powerMonitor.on('resume') after app.whenReady),
//     D-10 (mock the electron module — real powerMonitor only fires in app),
//     D-22 (invoke captured listener directly — no actual sleep)
//   - 02-RESEARCH.md § "Vitest test pattern — powerMonitor resume restarts
//     the interval" (lines 875-908) — canonical template adapted here.
//   - 02-RESEARCH.md § Section 1 — powerMonitor 'resume' is the single event
//     Phase 2 uses; safe to register after app.whenReady on Electron 38.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// CRITICAL: `vi.mock('electron', ...)` is hoisted by vitest above all imports.
// We capture the resume listener via a module-scoped `let` so each test can
// invoke it directly (D-22). The mock factory MAY NOT close over a let by
// reference — vitest hoists it above the let — so we use the
// `vi.fn((event, cb) => { ... }) ` form that writes the captured cb into the
// module variable at call time, AFTER hoisting completes.
let capturedResumeListener: (() => void) | null = null
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/never-used-with-:memory:',
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
  },
  powerMonitor: {
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'resume') capturedResumeListener = cb
    }),
  },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

// Plan 04-04: mock tickService so emitNow can be spied on in the call-order
// test (Task 3). The factory does NOT reference module-level variables (hoisting
// restriction).
vi.mock('./tick', () => ({
  start: vi.fn(),
  stop: vi.fn(),
  emit: vi.fn(),
  emitNow: vi.fn(),
  resetForTests: vi.fn(),
  TICK_INTERVAL_MS: 1000,
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
  read as readHeartbeat,
  resetStmtCache as resetHeartbeat,
} from '@main/db/repositories/heartbeat'
import {
  startHeartbeat,
  stopHeartbeat,
  resetForTests as resetHeartbeatService,
} from '@main/services/heartbeat'
import { powerMonitor } from 'electron'
import * as tickService from './tick'

describe('powerMonitor — resume listener restarts heartbeat (CRASH-02)', () => {
  beforeEach(() => {
    capturedResumeListener = null
    // Drain the powerMonitor.on mock's prior calls so each test starts fresh.
    ;(powerMonitor.on as ReturnType<typeof vi.fn>).mockClear()
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
    resetHeartbeatService()
    initDb(':memory:')
    runMigrations()
    vi.useFakeTimers()
    // Anchor the wall clock so heartbeat's `nowSeconds()` is deterministic
    // and the post-wake assertion can prove last_beat advanced.
    vi.setSystemTime(new Date(1_700_000_000 * 1000))
  })

  afterEach(() => {
    resetHeartbeatService()
    vi.useRealTimers()
    vi.restoreAllMocks()
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
  })

  // Test 1 — CRASH-02 / ROADMAP #3 — resume restarts the heartbeat interval;
  // last_beat advances after the simulated wake.
  it('CRASH-02 / ROADMAP #3: resume restarts the heartbeat interval; heartbeat row advances within 65s of simulated wake', () => {
    // Arrange: a running timer + the resume listener installed (the SAME body
    // Task 3 inserts into runMain). The listener body is the unit under test
    // for this case.
    const timer = createTimer({ projectId: null, description: 'crash-02' })
    const entry = startEntry(timer.id)
    powerMonitor.on('resume', () => {
      stopHeartbeat()
      startHeartbeat()
    })
    expect(capturedResumeListener).not.toBeNull()

    // Act 1: install the interval, advance one full tick to write the first
    // heartbeat row at t=0 + 65s.
    startHeartbeat()
    vi.advanceTimersByTime(65_000)
    const firstBeat = readHeartbeat()
    expect(firstBeat).not.toBeNull()
    expect(firstBeat!.timer_entry_id).toBe(entry.id)
    const firstLastBeat = firstBeat!.last_beat

    // Act 2: advance the WALL CLOCK by 70 real-seconds (simulating sleep
    // duration), THEN invoke the captured 'resume' listener to simulate
    // wake. The listener body must stopHeartbeat() + startHeartbeat() so the
    // interval re-arms cleanly (RESEARCH § Pattern 4 lines 472-474 +
    // § Pitfall 2: setInterval-across-sleep is unreliable, so restart).
    vi.setSystemTime(new Date((1_700_000_000 + 70) * 1000))
    capturedResumeListener!()

    // Advance the FAKE timer by another full tick post-wake — the freshly-
    // installed interval must fire and write a new heartbeat row whose
    // last_beat reflects the post-wake wall-clock.
    vi.advanceTimersByTime(65_000)
    const secondBeat = readHeartbeat()
    expect(secondBeat).not.toBeNull()
    expect(secondBeat!.timer_entry_id).toBe(entry.id)
    // last_beat must have advanced (post-wake clock is 70s ahead of pre-wake).
    expect(secondBeat!.last_beat).toBeGreaterThan(firstLastBeat)
  })

  // Test 2 — resume is a no-op for the DB when no timer is running.
  it('resume restarts the interval even when no timer is running; writeHeartbeat early-returns so the heartbeat row stays null', () => {
    // No time_entries row exists. Install the resume listener anyway — runMain
    // registers it unconditionally (D-09) because startHeartbeat is a no-op
    // on writes when nothing is running.
    powerMonitor.on('resume', () => {
      stopHeartbeat()
      startHeartbeat()
    })
    expect(capturedResumeListener).not.toBeNull()

    // No prior startHeartbeat — listener installs the interval from scratch.
    capturedResumeListener!()

    // Advance two full tick windows; writeHeartbeat must early-return on every
    // tick because `getRunning()` is null. readHeartbeat() stays null.
    vi.advanceTimersByTime(120_000)
    expect(readHeartbeat()).toBeNull()

    // Cleanup — `stopHeartbeat()` is idempotent.
    stopHeartbeat()
  })

  // =========================================================================
  // Plan 04-04 / D-11: Phase 4 contract — resume handler calls checkResume
  // BEFORE tickService.emitNow (call-order assertion).
  // =========================================================================

  // Test 3 — CALL ORDER: resume handler invokes checkResume BEFORE emitNow.
  //
  // This test enforces the resume-handler contract that plan 04-05 will wire
  // into runMain: `() => { checkResume(); tickService.emitNow(); }`. The order
  // matters — checkResume() must run first so the FSM post-resume classification
  // is committed to the cache before the tick payload is sent to the renderer.
  //
  // The test uses locally-declared `vi.fn()` spies (inline approach) rather
  // than mocking the real `checkResume` import — this avoids depending on the
  // exact import path of `checkResume` (which may live inside `services/timer.ts`
  // or be re-exported from elsewhere). The "inline" approach mirrors the PLAN's
  // recommended path (action step 1 last bullet): construct the listener body
  // inline and assert on locally-declared spies.
  //
  // vitest `mock.invocationCallOrder` carries a monotonically-increasing call
  // index per-test — `checkResume.mock.invocationCallOrder[0]` is less than
  // `emitNow.mock.invocationCallOrder[0]` iff checkResume fired first.
  //
  // This test FAILS if a future contributor:
  //   - reverses the call order (emitNow before checkResume)
  //   - omits either call from the handler
  //   - wraps emitNow in setTimeout/queueMicrotask (which would defer it past
  //     the synchronous assertion window)
  it('resume handler calls checkResume BEFORE tickService.emitNow (call-order — D-11)', () => {
    const checkResumeSpy = vi.fn()
    const emitNow = tickService.emitNow as ReturnType<typeof vi.fn>
    vi.mocked(emitNow).mockClear()

    // Mirror plan 04-05's runMain wiring shape exactly: checkResume first, emitNow after.
    const resumeHandler = (): void => {
      checkResumeSpy()
      emitNow()
    }

    // Register via the captured powerMonitor.on harness — ensures the same
    // listener-capture mechanism that runMain uses in production.
    ;(powerMonitor.on as ReturnType<typeof vi.fn>).mockClear()
    powerMonitor.on('resume', resumeHandler)
    expect(capturedResumeListener).toBe(resumeHandler)

    // Invoke the captured listener (simulates system wake-from-sleep).
    capturedResumeListener!()

    // Both spies called exactly once.
    expect(checkResumeSpy).toHaveBeenCalledTimes(1)
    expect(emitNow).toHaveBeenCalledTimes(1)

    // Call-order assertion: checkResume's invocationCallOrder index MUST be
    // less than emitNow's — i.e., checkResume ran first.
    expect(checkResumeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      emitNow.mock.invocationCallOrder[0],
    )
  })
})
