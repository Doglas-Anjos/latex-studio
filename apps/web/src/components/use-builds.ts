import { useQuery } from '@tanstack/react-query';
import { useService } from '../di/service-provider';
import { CompileServiceToken, isActive } from '../services/compile.service';

/** Latest builds (newest first); polls every 1.5 s while the newest one is queued or running. */
export function useBuilds(projectId: string) {
  const compile = useService(CompileServiceToken);
  return useQuery({
    queryKey: ['builds', projectId],
    queryFn: () => compile.builds(projectId, 5),
    refetchInterval: (query) => (isActive(query.state.data?.[0]) ? 1500 : false),
  });
}
