// src/shared/errors.ts
// IPC-survivable error subclasses. Refines CONTEXT.md D-14.
//
// REALITY CHECK (RESEARCH.md §4, VERIFIED via electronjs.org/docs):
//
//   "Errors thrown through `handle` in the main process are not transparent —
//    they are serialized and only the `message` property from the original
//    error is provided to the renderer process."
//
// Class identity does NOT survive Electron's IPC structured-clone — only
// `.message` survives. Custom fields (`.code`, `.details`, etc.) are stripped.
// Subclasses encode their kind into the message prefix; the preload bridge
// calls `reviveError` on every caught error to rebuild the typed subclass on
// the renderer side. Renderer code can then `try { ... } catch (e) { if (e
// instanceof ValidationError) ... }` normally.
//
// Refs:
//   - CONTEXT.md D-14 (original "handlers throw native Error subclasses"
//     decision; this module refines that with prefix encoding)
//   - RESEARCH.md §4 "Error Propagation Reality Check" lines ~843-898
//     (Option A + B together is the recommendation)
//   - VALIDATION.md "Test Count Target" (errors.test.ts ≥ 4 tests)

const VALIDATION_PREFIX = '[VALIDATION] '
const NOT_FOUND_PREFIX = '[NOT_FOUND] '
const INVARIANT_PREFIX = '[INVARIANT] '

/**
 * Thrown when arguments arriving at an IPC handler fail Zod validation, or
 * when domain-layer code refuses an invalid value (e.g., negative offset,
 * empty description). Maps to a user-facing "you gave me bad input" error.
 */
export class ValidationError extends Error {
  constructor(msg: string) {
    super(`${VALIDATION_PREFIX}${msg}`)
    this.name = 'ValidationError'
  }
}

/**
 * Thrown when a repository lookup against a primary key (or a uniquely-keyed
 * lookup) returns no row. Maps to a user-facing "the row you asked about is
 * gone" error — typically a stale UI handle.
 */
export class NotFoundError extends Error {
  constructor(msg: string) {
    super(`${NOT_FOUND_PREFIX}${msg}`)
    this.name = 'NotFoundError'
  }
}

/**
 * Thrown when a domain invariant is violated server-side — e.g., the
 * "single active timer" rule in Phase 2 would throw this if a second
 * `time_entries` row with `end_timestamp IS NULL` were attempted. Maps to
 * an internal-bug-level error; the renderer should surface it loudly.
 */
export class InvariantError extends Error {
  constructor(msg: string) {
    super(`${INVARIANT_PREFIX}${msg}`)
    this.name = 'InvariantError'
  }
}

/**
 * Reconstruct the typed Error subclass from an error that crossed Electron's
 * IPC boundary. The preload bridge's `invokeWrapped` helper (plan 04) wraps
 * every `ipcRenderer.invoke` call in a try/catch that calls this function
 * on the caught error and re-throws — so renderer code can use normal
 * `try { ... } catch (e) { if (e instanceof ValidationError) ... }` flow.
 *
 * - Non-Error inputs are coerced to a generic `Error`.
 * - Plain Errors whose `.message` matches a known prefix are rebuilt as the
 *   matching subclass with the prefix stripped from `.message`.
 * - Plain Errors with no recognized prefix are returned unchanged (same
 *   identity, same `.message`) — they are NOT promoted to any subclass.
 *
 * @param e the error caught at the IPC boundary
 * @returns the typed subclass (if recognized) or the original Error
 */
/**
 * Internal helper: rebuild a typed subclass on the renderer side WITHOUT
 * re-applying the wire prefix.
 *
 * Why we can't just call `new SubClass(bare)`: the subclass constructors
 * prepend the wire prefix to `.message` so the discriminator survives IPC's
 * structuredClone (which only copies `.message`). On the renderer side we
 * want the OPPOSITE — strip the prefix back off — so the receiver sees the
 * bare domain message while `instanceof` still works. Constructing via
 * `Object.create(SubClass.prototype)` bypasses the constructor and lets us
 * set `.message` directly to the stripped string.
 */
function reviveAs<T extends Error>(
  SubClass: new (msg: string) => T,
  bareMsg: string,
  originalStack: string | undefined,
): T {
  const instance = Object.create(SubClass.prototype) as T
  instance.message = bareMsg
  instance.name = SubClass.name
  if (originalStack !== undefined) {
    instance.stack = originalStack
  }
  return instance
}

export function reviveError(e: unknown): Error {
  if (!(e instanceof Error)) {
    return new Error(String(e))
  }
  if (e.message.startsWith(VALIDATION_PREFIX)) {
    return reviveAs(ValidationError, e.message.slice(VALIDATION_PREFIX.length), e.stack)
  }
  if (e.message.startsWith(NOT_FOUND_PREFIX)) {
    return reviveAs(NotFoundError, e.message.slice(NOT_FOUND_PREFIX.length), e.stack)
  }
  if (e.message.startsWith(INVARIANT_PREFIX)) {
    return reviveAs(InvariantError, e.message.slice(INVARIANT_PREFIX.length), e.stack)
  }
  return e
}
