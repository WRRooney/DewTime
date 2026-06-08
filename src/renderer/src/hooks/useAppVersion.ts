import { useQuery } from '@tanstack/react-query'

/** Query key for the running app version (never changes at runtime). */
export const appVersionQueryKey = ['system', 'version'] as const

/** Returns the running app version string via system.getVersion IPC. staleTime Infinity — version does not change at runtime. */
export function useAppVersion() {
  return useQuery<string>({
    queryKey: appVersionQueryKey,
    queryFn: () => window.api.system.getVersion(),
    staleTime: Infinity,
  })
}
