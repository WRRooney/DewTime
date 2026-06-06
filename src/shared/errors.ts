// IPC-survivable error subclasses.
//
// Class identity does NOT survive Electron's IPC structured-clone — only
// `.message` survives. Custom fields (`.code`, `.details`, etc.) are stripped.
// Subclasses encode their kind into the message prefix; the preload bridge
// calls `reviveError` on every caught error to rebuild the typed subclass on
// the renderer side so renderer code can use normal `instanceof` checks.

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
 * Thrown when a domain invariant is violated server-side — e.g., attempting
 * a second `time_entries` row with `end_timestamp IS NULL` (single-active-timer
 * rule). Internal-bug-level error; the renderer should surface it loudly.
 */
export class InvariantError extends Error {
  constructor(msg: string) {
    super(`${INVARIANT_PREFIX}${msg}`)
    this.name = 'InvariantError'
  }
}

/**
 * Internal helper: rebuild a typed subclass on the renderer side WITHOUT
 * re-applying the wire prefix.
 *
 * We can't call `new SubClass(bare)` because the constructors prepend the wire
 * prefix again. `Object.create(SubClass.prototype)` bypasses the constructor so
 * we can set `.message` directly to the stripped string while `instanceof` still works.
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
