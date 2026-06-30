// Per-project weekly + all-time hours aggregation for the Projects manager window.
//
// The #projects BrowserWindow does NOT mount <SettingsProvider>, so useSettings()
// is unavailable. weekStart is fetched directly via window.api.settings.list().
//
// ASSUMPTION: defaults to Monday (weekStart=0) if settings.week_start is missing
// or unreadable, matching the SettingsContext seed default.
//
// Sums use Timer.totalSeconds (completed seconds). The running-entry live tick is
// NOT added here — the weekly/total badges are settled totals, not per-second
// tickers, keeping the projects list off the tick channel.

import { useQuery } from '@tanstack/react-query'
import type { Timer } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'
import { weekRangeOf } from '@/utils/date-ranges'

export interface ProjectHoursEntry {
  weekSeconds: number
  totalSeconds: number
}

export interface UseProjectHoursResult {
  hours: Map<number, ProjectHoursEntry>
  isLoading: boolean
}

/**
 * Returns a Map keyed by project_id with per-project { weekSeconds, totalSeconds }.
 * Timers with project_id === null are excluded.
 * Only the display layer should call this — one call per ProjectsManager mount.
 */
export function useProjectHours(): UseProjectHoursResult {
  // ── Settings: resolve weekStart ──────────────────────────────────────────
  const { data: settingsMap, isLoading: settingsLoading } = useQuery<Record<string, unknown>>({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.list(),
    staleTime: 60_000, // settings change rarely
  })

  // Derive weekStart using the same mapping as SettingsContext.tsx narrowWeekStart.
  // value === 6 → Sunday (6), everything else → Monday (0).
  const rawWeekStart = settingsMap?.['settings.week_start']
  const weekStart: 0 | 6 = rawWeekStart === 6 ? 6 : 0

  // ── Week range (recomputed each render, stable once date doesn't change) ──
  const { fromEpoch, toEpoch } = weekRangeOf(new Date(), weekStart)

  // ── All-time timers ───────────────────────────────────────────────────────
  const { data: allTimers = [], isLoading: allLoading } = useQuery<Timer[]>({
    queryKey: ['timers'],
    queryFn: () => window.api.timers.list(),
    staleTime: 100,
  })

  // ── Current-week timers ───────────────────────────────────────────────────
  // Key shape ['timers', { from, to }] matches useWeekTimers so existing
  // mutation invalidations on ['timers'] prefix propagate here automatically.
  const { data: weekTimers = [], isLoading: weekLoading } = useQuery<Timer[]>({
    queryKey: ['timers', { from: fromEpoch, to: toEpoch }],
    queryFn: () =>
      window.api.timers.list({
        fromEpoch: fromEpoch as EpochSeconds,
        toEpoch: toEpoch as EpochSeconds,
      }),
    staleTime: 100,
    // Only run once weekStart is resolved (settings query succeeded or defaulted)
    enabled: !settingsLoading,
  })

  // ── Reduce into per-project map ───────────────────────────────────────────
  const hours = new Map<number, ProjectHoursEntry>()

  // Build totals from all-time list
  for (const timer of allTimers) {
    if (timer.project_id === null) continue
    const existing = hours.get(timer.project_id)
    if (existing) {
      existing.totalSeconds += timer.totalSeconds
    } else {
      hours.set(timer.project_id, { weekSeconds: 0, totalSeconds: timer.totalSeconds })
    }
  }

  // Add week seconds from week list
  for (const timer of weekTimers) {
    if (timer.project_id === null) continue
    const existing = hours.get(timer.project_id)
    if (existing) {
      existing.weekSeconds += timer.totalSeconds
    } else {
      // timer appeared in week but not in all-time (shouldn't happen, but safe)
      hours.set(timer.project_id, { weekSeconds: timer.totalSeconds, totalSeconds: timer.totalSeconds })
    }
  }

  const isLoading = settingsLoading || allLoading || weekLoading

  return { hours, isLoading }
}
