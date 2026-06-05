// src/renderer/src/contexts/SettingsContext.tsx
// React Context that owns the renderer-side settings cache. Loads from
// `window.api.settings.list()` once on mount (D-17) and exposes
// `useSettings()` returning `{ weekStart, setWeekStart, refresh }`. The
// dialog (SettingsDialog) initializes its draft form state from
// `useSettings().weekStart`; on Apply/OK the dialog persists via
// `window.api.settings.set(...)` and then calls `setWeekStart(value)` to
// rehydrate the context optimistically.
//
// Phase 3 surfaces ONLY `settings.week_start` (D-16). The other Phase-1
// SettingKeys (dark_mode, auto_pause, widget_mode, auto_launch) stay at
// seeded defaults and are NOT exposed here — SET-FUT-* defer.
//
// Refs:
//   - 03-CONTEXT.md D-15, D-16, D-17 (settings cache + only week_start)
//   - 03-CONTEXT.md D-24 (React Context only — no Zustand/Redux/Jotai in Phase 3)
//   - 03-RESEARCH.md § Pattern 9 (SettingsContext literal)
//   - src/shared/ipc.ts (SettingsApi + SettingKey + SettingValue<K>)
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

/**
 * Phase-3 narrowing: only Monday (0) and Sunday (6) are reachable. The repo
 * stores `settings.week_start` as `number` (SettingValue<'settings.week_start'>
 * = number per src/shared/ipc.ts), and the SQLite seed in 001_initial.sql is
 * 0 (Monday). The narrowing here is the renderer-side type guard; any other
 * integer coming back from IPC (e.g., a hand-edited DB) is coerced to 0.
 */
export type WeekStart = 0 | 6

export interface SettingsContextValue {
  weekStart: WeekStart
  /**
   * Optimistic local-state update. The dialog already awaited the IPC
   * settings.set before calling this — this hook is the cache rehydrate.
   * Returns a Promise so future async refresh paths (e.g., re-read after
   * conflict) can extend without changing the call site.
   */
  setWeekStart: (value: WeekStart) => Promise<void>
  /** Re-fetch from `window.api.settings.list()`. Called automatically on mount. */
  refresh: () => Promise<void>
}

const Ctx = createContext<SettingsContextValue | null>(null)

/**
 * Defensive narrowing: SettingsApi.list returns
 * `Promise<Record<SettingKey, unknown>>` (JSON-decoded values; the repo
 * doesn't know per-key value types at runtime). Coerce anything that isn't
 * literal 6 to 0 (Monday — the seeded default).
 */
function narrowWeekStart(value: unknown): WeekStart {
  return value === 6 ? 6 : 0
}

export function SettingsProvider({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  const [weekStart, setWeekStartState] = useState<WeekStart>(0)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await window.api.settings.list()
      setWeekStartState(narrowWeekStart(all['settings.week_start']))
    } catch (err) {
      // The dialog's own Apply/OK path catches IPC errors and surfaces the
      // inline "Could not save settings. Try again." string. The initial
      // mount-time refresh failing here would mean settings IPC is broken
      // entirely — keep the seeded default (0) and log so the dev sees it.
      // eslint-disable-next-line no-console
      console.error('SettingsContext refresh failed:', err)
    }
  }, [])

  const setWeekStart = useCallback(async (value: WeekStart): Promise<void> => {
    setWeekStartState(value)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <Ctx.Provider value={{ weekStart, setWeekStart, refresh }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const value = useContext(Ctx)
  if (value === null) {
    throw new Error('useSettings must be called inside <SettingsProvider>')
  }
  return value
}
