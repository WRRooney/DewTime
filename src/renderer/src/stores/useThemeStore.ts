// src/renderer/src/stores/useThemeStore.ts
// Light/dark theme toggle, persisted to localStorage and applied as
// `data-theme="light|dark"` on <html>. tokens.css defines the dark palette on
// :root (the default) and a `:root[data-theme="light"]` override block.
//
// localStorage (not the SQLite settings.dark_mode key) keeps the toggle
// instant and renderer-local — same rationale as useColumnWidths: this is
// applied view-state, and wiring it through the settings IPC contract +
// SettingsContext would add ceremony for no functional gain here.
//
// The module APPLIES the persisted theme at import time (before React mounts,
// since main.tsx imports it right after globals.css) so there's no flash of
// the wrong theme on load.

import { create } from 'zustand'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'timerz.theme'

function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* private mode / no storage — fall through to default */
  }
  return 'dark' // app shipped dark-first
}

function applyTheme(theme: Theme): void {
  try {
    document.documentElement.dataset.theme = theme
  } catch {
    /* no DOM (e.g. unit env) — no-op */
  }
}

// Resolve + apply once at module eval so the correct palette is live before
// the first paint.
const initialTheme = loadTheme()
applyTheme(initialTheme)

interface ThemeState {
  theme: Theme
  /** Set an explicit theme (applies + persists). */
  setTheme: (theme: Theme) => void
  /** Flip light ↔ dark. */
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    applyTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* ignore persistence failure */
    }
    set({ theme })
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}))
