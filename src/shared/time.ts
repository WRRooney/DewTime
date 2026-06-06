// Branded epoch-second timestamps. The ONE module that may call Date.now().
// All other code in main / preload / renderer must obtain epoch seconds via
// `nowSeconds()` — never raw `Date.now()`, never `Math.round(...)`.

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
 * rounding up would drift v2 timestamps one second ahead of rows persisted
 * by v1. Raw `Date.now()` is forbidden outside this module.
 *
 * @returns the current Unix time in seconds, branded as `EpochSeconds`
 */
export function nowSeconds(): EpochSeconds {
  return Math.floor(Date.now() / 1000) as EpochSeconds
}
