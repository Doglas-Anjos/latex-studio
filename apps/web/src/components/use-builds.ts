import { useQuery } from '@tanstack/react-query';
import { useService } from '../di/service-provider';
import { CompileServiceToken, isActive } from '../services/compile.service';

/**
 * Latest builds (newest first); polls every 1.5 s while the newest one is queued or running.
 * `watchIdle` also checks every 10 s when idle, for someone who cannot compile here (a LAN guest
 * while the host compiles): they never start a build, so nothing else would show the host's.
 */
export function useBuilds(projectId: string, watchIdle = false) {
  const compile = useService(CompileServiceToken);
  return useQuery({
    queryKey: ['builds', projectId],
    queryFn: () => compile.builds(projectId, 5),
    refetchInterval: (query) =>
      isActive(query.state.data?.[0]) ? 1500 : watchIdle ? 10_000 : false,
    // Keep polling a queued/running build even when the tab is backgrounded, so the wait estimate
    // and status stay current if the user steps away during a long compile.
    refetchIntervalInBackground: true,
  });
}
