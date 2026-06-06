import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

/** Only Monday (0) and Sunday (6) are valid; any other IPC integer is coerced to 0. */
export type WeekStart = 0 | 6

export interface SettingsContextValue {
  weekStart: WeekStart
  /** Optimistic cache rehydrate — caller has already persisted via IPC. */
  setWeekStart: (value: WeekStart) => Promise<void>
  alwaysOnTop: boolean
  /** Optimistic cache rehydrate — caller has already persisted via IPC. */
  setAlwaysOnTop: (value: boolean) => Promise<void>
  autoUpdate: boolean
  /** Optimistic cache rehydrate — caller has already persisted via IPC. */
  setAutoUpdate: (value: boolean) => Promise<void>
  /** Re-fetch from `window.api.settings.list()`. Called automatically on mount. */
  refresh: () => Promise<void>
}

const Ctx = createContext<SettingsContextValue | null>(null)

/** Coerce anything that isn't literal 6 to 0 (Monday — the seeded default). */
function narrowWeekStart(value: unknown): WeekStart {
  return value === 6 ? 6 : 0
}

export function SettingsProvider({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  const [weekStart, setWeekStartState] = useState<WeekStart>(0)
  const [alwaysOnTop, setAlwaysOnTopState] = useState<boolean>(false)
  // Default true — current behavior is updates always enabled.
  const [autoUpdate, setAutoUpdateState] = useState<boolean>(true)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await window.api.settings.list()
      setWeekStartState(narrowWeekStart(all['settings.week_start']))
      setAlwaysOnTopState(all['settings.always_on_top'] === true)
      // Default true: only an explicit stored false disables updates (missing/undefined stays true).
      setAutoUpdateState(all['settings.auto_update'] !== false)
    } catch (err) {
      // Mount-time failure means settings IPC is broken; keep the seeded default and log.
      // eslint-disable-next-line no-console
      console.error('SettingsContext refresh failed:', err)
    }
  }, [])

  const setWeekStart = useCallback(async (value: WeekStart): Promise<void> => {
    setWeekStartState(value)
  }, [])

  const setAlwaysOnTop = useCallback(async (value: boolean): Promise<void> => {
    setAlwaysOnTopState(value)
  }, [])

  const setAutoUpdate = useCallback(async (value: boolean): Promise<void> => {
    setAutoUpdateState(value)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <Ctx.Provider value={{ weekStart, setWeekStart, alwaysOnTop, setAlwaysOnTop, autoUpdate, setAutoUpdate, refresh }}>
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
