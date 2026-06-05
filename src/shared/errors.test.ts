// src/shared/errors.test.ts
// Source: RESEARCH.md §4 lines ~843-898 "Error Propagation Reality Check"
// Four tests per VALIDATION.md "Test Count Target" — covers the IPC-survivable
// prefix-encoded error contract that refines CONTEXT.md D-14.
//
// Background: Electron IPC structured-clone strips Error subclass identity —
// only `.message` survives across the bridge. The renderer receives a plain
// `Error` whose `.message` carries the prefix; `reviveError` rebuilds the
// typed subclass from that prefix so React try/catch (e: ValidationError)
// works as intended.
import { describe, it, expect } from 'vitest'
import {
  ValidationError,
  NotFoundError,
  InvariantError,
  reviveError,
} from './errors'

describe('Error subclasses', () => {
  it('ValidationError prefixes [VALIDATION] and sets name', () => {
    const e = new ValidationError('bad input')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(ValidationError)
    expect(e.message).toBe('[VALIDATION] bad input')
    expect(e.name).toBe('ValidationError')
  })

  it('NotFoundError prefixes [NOT_FOUND] and sets name', () => {
    const e = new NotFoundError('row 42')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(NotFoundError)
    expect(e.message).toBe('[NOT_FOUND] row 42')
    expect(e.name).toBe('NotFoundError')
  })

  it('InvariantError prefixes [INVARIANT] and sets name', () => {
    const e = new InvariantError('two running')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(InvariantError)
    expect(e.message).toBe('[INVARIANT] two running')
    expect(e.name).toBe('InvariantError')
  })
})

describe('reviveError (IPC round-trip)', () => {
  it('rebuilds ValidationError from a plain Error that crossed IPC', () => {
    // Simulate what the renderer receives — plain Error, only .message survives.
    const acrossIpc = new Error('[VALIDATION] bad input')
    const revived = reviveError(acrossIpc)
    expect(revived).toBeInstanceOf(ValidationError)
    expect(revived.message).toBe('bad input')
  })

  it('rebuilds NotFoundError from a plain Error that crossed IPC', () => {
    const acrossIpc = new Error('[NOT_FOUND] row 42')
    const revived = reviveError(acrossIpc)
    expect(revived).toBeInstanceOf(NotFoundError)
    expect(revived.message).toBe('row 42')
  })

  it('rebuilds InvariantError from a plain Error that crossed IPC', () => {
    const acrossIpc = new Error('[INVARIANT] two running')
    const revived = reviveError(acrossIpc)
    expect(revived).toBeInstanceOf(InvariantError)
    expect(revived.message).toBe('two running')
  })

  it('returns the original Error unchanged when no recognized prefix matches', () => {
    const plain = new Error('something else')
    const revived = reviveError(plain)
    // Identity preserved: same object, untouched .message.
    expect(revived).toBe(plain)
    expect(revived.message).toBe('something else')
    // Crucially NOT promoted to any subclass.
    expect(revived instanceof ValidationError).toBe(false)
    expect(revived instanceof NotFoundError).toBe(false)
    expect(revived instanceof InvariantError).toBe(false)
  })

  it('coerces non-Error inputs to a generic Error', () => {
    // Defensive: ipcRenderer.invoke could in theory reject with a non-Error.
    const revived = reviveError('plain string')
    expect(revived).toBeInstanceOf(Error)
    expect(revived.message).toBe('plain string')
  })

  it('round-trips through the IPC envelope (subclass → plain Error → subclass)', () => {
    // End-to-end shape: throw subclass on main; only .message survives across
    // the bridge; renderer's preload calls reviveError on the caught error.
    const thrownOnMain = new ValidationError('bad input')
    const acrossIpc = new Error(thrownOnMain.message) // structured-clone analogue
    const inRenderer = reviveError(acrossIpc)
    expect(inRenderer).toBeInstanceOf(ValidationError)
    expect(inRenderer.message).toBe('bad input')
  })
})
