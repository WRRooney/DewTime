// @vitest-environment jsdom
// src/renderer/src/components/timer-table/cells/DeleteCell.test.tsx
// Tests for DeleteCell click → useConfirmDeleteStore.open behavior.
//
// Contract under test:
//   1. Click with timer.description → useConfirmDeleteStore.pendingDelete = { id, label: description }
//   2. Click with empty description → label is '(no description)'
//
// Refs:
//   - 04-UI-SPEC.md § DeleteCell (click → confirm store)
//   - 04-CONTEXT.md D-32 (Phase 4 renderer test coverage)
//   - Anti-pattern A-13: DeleteCell does NOT import the tick store

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { DeleteCell } from './DeleteCell'
import { useConfirmDeleteStore } from '@/stores/useConfirmDeleteStore'
import type { Timer } from '@shared/ipc'

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 7,
    project_id: null,
    description: 'foo',
    notes: '',
    created_at: 1700000000,
    offset: null,
    totalSeconds: 0,
    running: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeleteCell', () => {
  beforeEach(() => {
    useConfirmDeleteStore.setState({ pendingDelete: null })
    window.api = makeMockApi()
  })

  afterEach(() => {
    cleanup()
  })

  it('click opens confirm store with timer.id and description as label', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 7, description: 'foo' })

    renderWithProviders(<DeleteCell timer={timer} />)

    await user.click(screen.getByRole('button', { name: 'Delete timer' }))

    expect(useConfirmDeleteStore.getState().pendingDelete).toEqual({ id: 7, label: 'foo' })
  })

  it('click uses "(no description)" label when description is empty', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 9, description: '' })

    renderWithProviders(<DeleteCell timer={timer} />)

    await user.click(screen.getByRole('button', { name: 'Delete timer' }))

    expect(useConfirmDeleteStore.getState().pendingDelete).toEqual({ id: 9, label: '(no description)' })
  })
})
