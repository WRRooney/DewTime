// src/shared/time.ts
// Branded epoch-second timestamps. The ONE module that may call Date.now().
// All other code in main / preload / renderer must obtain epoch seconds via
// `nowSeconds()` — never raw `Date.now()`, never `Math.round(...)`.
//
// Refs:
//   - CONTEXT.md D-05 (branded EpochSeconds, single sanctioned constructor)
//   - CONTEXT.md "Specific Ideas" (Math.floor matches v1 Python int(time.time()))
//   - DATA-04 (timestamps stored as INTEGER seconds, < 2_000_000_000)
//   - RESEARCH.md §9 lines ~1330-1360 (test contract)

/**
 * Branded epoch-seconds type. A `number` at runtime, but the structural brand
 * prevents raw numbers from being implicitly assigned to an `EpochSeconds`
 * variable. The only sanctioned constructor is `nowSeconds()` below;
 * repositories that read epoch values out of SQLite cast their result with
 * `as EpochSeconds` at the read boundary.
 *
 * The brand is removed by the TypeScript erasure pass, so this carries zero
 * runtime cost.
 */
export type EpochSeconds = number & { readonly __brand: 'EpochSeconds' }

/**
 * The ONLY sanctioned constructor of `EpochSeconds`. Uses `Math.floor`
 * (NOT `Math.round`) to match v1's Python `int(time.time())` semantics —
 * this matters when v2 reads timer rows persisted by v1: a half-second
 * rounding-up boundary would drift v2 timestamps one second ahead of v1.
 *
 * Forbid raw `Date.now()` outside this module (per CONTEXT.md D-05).
 *
 * @returns the current Unix time in seconds, branded as `EpochSeconds`
 */
export function nowSeconds(): EpochSeconds {
  return Math.floor(Date.now() / 1000) as EpochSeconds
}
