import { useQuery } from '@tanstack/react-query';
import { useService } from '../di/service-provider';
import { HistoryServiceToken } from '../services/history.service';

/** Files changed since the last saved version; one shared query for tree and activity bar. */
export function useHistoryStatus(projectId: string) {
  const history = useService(HistoryServiceToken);
  return useQuery({
    queryKey: ['history', projectId, 'status'],
    queryFn: () => history.status(projectId),
    refetchInterval: 30_000,
    // Uploads, saves and restores invalidate it; opening a tab should not walk the repo again.
    staleTime: 15_000,
  });
}
