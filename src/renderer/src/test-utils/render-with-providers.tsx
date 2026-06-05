// src/renderer/src/test-utils/render-with-providers.tsx
// render() wrapper that mounts a fresh QueryClient + QueryClientProvider per
// test so cache state never leaks between test cases.
//
// Usage:
// ```tsx
// import { renderWithProviders } from '@renderer/test-utils/render-with-providers'
//
// it('renders timer list', () => {
//   const { getByText } = renderWithProviders(<TimerTable />)
//   expect(getByText('My timer')).toBeInTheDocument()
// })
// ```
//
// Refs:
//   - 04-RESEARCH.md § Pattern 2 (QueryClient defaultOptions for test isolation)
//   - 04-PATTERNS.md § render-with-providers.tsx
//   - 04-RESEARCH.md § Validation Architecture Wave 0 Gaps

import React from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Renders `ui` inside a fresh `<QueryClientProvider>` with a new `QueryClient`
 * per call. The `retry: false` + `refetchOnWindowFocus: false` defaults prevent
 * test flakiness from retry loops and focus-triggered refetches.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })

  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  return render(ui, { wrapper: Wrapper, ...options })
}
