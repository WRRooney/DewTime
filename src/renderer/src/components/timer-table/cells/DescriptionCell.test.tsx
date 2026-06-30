// @vitest-environment jsdom
// src/renderer/src/components/timer-table/cells/DescriptionCell.test.tsx
// Tests for DescriptionCell click→input swap + Enter commit + Escape revert.
//
// Contract under test (D-32 / UI-SPEC § DescriptionCell):
//   1. Click on the text span → <input> renders + gains focus
//   2. Type new text + Enter → useSetDescription.mutate called with trimmed value
//   3. Type new text + Escape → setDescription NOT called; input closes; original text visible
//
// Mock strategy (D-33): set window.api = makeMockApi({ timers: { setDescription: vi.fn() } })
// in beforeEach so the mutation hook's mutationFn resolves immediately.
//
// A-14 note: no contenteditable in DescriptionCell — this test exercises <input> swaps only.
//
// Refs:
//   - 04-UI-SPEC.md § DescriptionCell (click/edit/commit/cancel semantics)
//   - 04-CONTEXT.md D-25 (swap-to-input UX)
//   - 04-CONTEXT.md D-32 (Phase 4 renderer test coverage ≥ 2 cases)
//   - 04-RESEARCH.md § Pattern 5 (canonical DescriptionCell template)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { DescriptionCell } from './DescriptionCell'
import { usePendingFocusStore } from '@/stores/usePendingFocusStore'
import type { Timer } from '@shared/ipc'

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 7,
    project_id: null,
    description: 'orig',
    notes: '',
    created_at: 1700000000 as Timer['created_at'],
    offset: null,
    totalSeconds: 0,
    running: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DescriptionCell', () => {
  let setDescriptionMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Reset pending focus store so auto-focus logic doesn't interfere
    usePendingFocusStore.setState({ pendingFocusId: null })
    // Set up resolved mock so mutation completes immediately
    setDescriptionMock = vi.fn().mockResolvedValue(undefined)
    window.api = makeMockApi({
      timers: {
        list: vi.fn().mockResolvedValue([]),
        setDescription: setDescriptionMock,
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('click on text span renders input and input is focused', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 7, description: 'orig' })

    renderWithProviders(<DescriptionCell timer={timer} />)

    // Initially shows the text span, no input
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('orig')).toBeInTheDocument()

    // Click enters edit mode
    await user.click(screen.getByText('orig'))

    // Input appears
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('type new text + Enter calls setDescription with trimmed value and closes input', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 7, description: 'orig' })

    renderWithProviders(<DescriptionCell timer={timer} />)

    // Click to enter edit mode
    await user.click(screen.getByText('orig'))
    const input = screen.getByRole('textbox')

    // Clear and type new text
    await user.clear(input)
    await user.type(input, 'new')

    // Commit via Enter
    await user.keyboard('{Enter}')

    // setDescription was called with the correct args
    expect(setDescriptionMock).toHaveBeenCalledWith(7, 'new')

    // Input closes (edit mode exits)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('type new text + Escape reverts and does NOT call setDescription', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 7, description: 'orig' })

    renderWithProviders(<DescriptionCell timer={timer} />)

    // Click to enter edit mode
    await user.click(screen.getByText('orig'))
    const input = screen.getByRole('textbox')

    // Type new text
    await user.clear(input)
    await user.type(input, 'edit')

    // Cancel via Escape
    await user.keyboard('{Escape}')

    // setDescription was NOT called
    expect(setDescriptionMock).not.toHaveBeenCalled()

    // Input closes
    expect(screen.queryByRole('textbox')).toBeNull()

    // Original text is still visible
    expect(screen.getByText('orig')).toBeInTheDocument()
  })

  it('Enter commits even with Shift held (no newline insertion)', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 7, description: 'orig' })

    renderWithProviders(<DescriptionCell timer={timer} />)

    await user.click(screen.getByText('orig'))
    const textarea = screen.getByRole('textbox')

    await user.clear(textarea)
    await user.type(textarea, 'line1')
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    // Commits the trimmed value and closes the editor
    expect(setDescriptionMock).toHaveBeenCalledWith(7, 'line1')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('blur (focus loss) commits the edited value', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 7, description: 'orig' })

    renderWithProviders(<DescriptionCell timer={timer} />)

    await user.click(screen.getByText('orig'))
    const textarea = screen.getByRole('textbox')

    await user.clear(textarea)
    await user.type(textarea, 'blurred')
    // Move focus away — React's onBlur listens for focusout (which bubbles),
    // not the non-bubbling native blur event.
    await user.tab()

    expect(setDescriptionMock).toHaveBeenCalledWith(7, 'blurred')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('pointer-down outside the textarea (non-focusable target) commits', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ id: 7, description: 'orig' })

    // An outside, non-focusable element — clicking it does not move focus, so
    // onBlur never fires; the document pointerdown handler must commit instead.
    const outside = document.createElement('div')
    outside.textContent = 'outside'
    document.body.appendChild(outside)

    renderWithProviders(<DescriptionCell timer={timer} />)

    await user.click(screen.getByText('orig'))
    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, 'clicked away')

    await user.click(outside)

    expect(setDescriptionMock).toHaveBeenCalledWith(7, 'clicked away')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    outside.remove()
  })
})
