// src/shared/time.test.ts
// Source: RESEARCH.md §9 "Branded-Type Assertions" (lines ~1330-1360)
// Five tests per VALIDATION.md "Test Count Target" — covers TEST-01 acceptance #5
// + DATA-04 (timestamps stored as INTEGER seconds, `nowSeconds() < 2_000_000_000`).
import { describe, it, expect } from 'vitest'
import { nowSeconds, type EpochSeconds } from './time'

describe('nowSeconds', () => {
  it('returns less than 2_000_000_000 (epoch-seconds guard — TEST-01 #5)', () => {
    // 2_000_000_000 ≈ 2033-05-18. Catches accidental ms timestamps (Date.now())
    // which run in the ~1.7e12 range today.
    expect(nowSeconds()).toBeLessThan(2_000_000_000)
  })

  it('returns at least 1_700_000_000 (post-Nov-2023 sanity)', () => {
    // 1_700_000_000 ≈ 2023-11-14. Catches accidental seconds-since-epoch-with-wrong-unit
    // (e.g., minutes or hours).
    expect(nowSeconds()).toBeGreaterThanOrEqual(1_700_000_000)
  })

  it('returns an integer (Math.floor, not Math.round)', () => {
    // Math.floor(Date.now() / 1000) is required to match v1 Python int(time.time())
    // semantics (CONTEXT.md "Specific Ideas"). Math.round would round-up the half-second
    // boundary and drift one second ahead of v1 timestamps.
    expect(Number.isInteger(nowSeconds())).toBe(true)
  })

  it('compiles when assigned to a variable of type EpochSeconds', () => {
    // Branded type permits return-from-constructor assignment. If the brand were
    // removed, this would still compile — but the next test (@ts-expect-error)
    // would fail to flag, signalling the brand has been weakened.
    const t: EpochSeconds = nowSeconds()
    expect(typeof t).toBe('number')
  })

  it('forbids implicit number → EpochSeconds assignment at compile time', () => {
    // This is a compile-time test, not a runtime test. Vitest surfaces TypeScript
    // errors during transpile, so if the brand on EpochSeconds is removed (e.g.,
    // someone aliases it to `number`), the @ts-expect-error directive becomes
    // unused and the build fails. Both the runtime and the compile-time guard
    // are part of the brand contract.
    // @ts-expect-error — raw number must not be assignable to EpochSeconds
    const t: EpochSeconds = 1_700_000_000
    expect(t).toBeGreaterThan(0)
  })
})
