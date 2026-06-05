// vitest.setup.renderer.ts
// Renderer-process vitest setup file — imports @testing-library/jest-dom
// matchers so specs can use toBeInTheDocument(), toHaveTextContent(), etc.
//
// Phase 5 addition: polyfill ResizeObserver for jsdom (required by cmdk which
// uses it internally for keyboard list navigation). jsdom does not implement
// ResizeObserver; the no-op stub is sufficient for component tests.
//
// Refs:
//   - 04-PATTERNS.md § vitest.setup.renderer.ts
//   - 04-RESEARCH.md § Example E (vitest-setup.ts canonical line)
//   - vitest.renderer.config.ts setupFiles reference
import '@testing-library/jest-dom/vitest'

// Polyfill ResizeObserver for cmdk (not implemented in jsdom).
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Polyfill scrollIntoView for cmdk (not implemented in jsdom).
// cmdk calls scrollIntoView() on highlighted list items for keyboard navigation.
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = function () {}
}
