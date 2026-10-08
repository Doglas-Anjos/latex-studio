import { useQuery } from '@tanstack/react-query';
import { useService } from './di/service-provider';
import { AuthServiceToken } from './services/auth.service';

export function useMe() {
  const auth = useService(AuthServiceToken);
  return useQuery({
    queryKey: ['me'],
    queryFn: () => auth.me(),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
