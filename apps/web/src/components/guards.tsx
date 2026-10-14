import { useEffect } from 'react';
import { useMe } from '../auth-hooks';
import { useService } from '../di/service-provider';
import { ApiError } from '../services/api-client';
import { IdentityToken } from '../services/identity';
import { Button } from './button';
import { Layout } from './layout';

export function RequireAuth() {
  const identity = useService(IdentityToken);
  const { data: user, error, isPending, isFetching, refetch } = useMe();
  // FasorX says the session ended: straight to its login, no breaker (it only sends people back
  // once they have a session, so there is no loop; the breaker here read a fresh login as one).
  useEffect(() => identity.watch(() => identity.goToLogin()), [identity]);
  if (isPending) return <p className="status-note">Carregando…</p>;
  // The API client already went to log in ("Entrando…"), or says why it did not.
  if (error instanceof ApiError && error.status === 401 && identity.enabled)
    return <p className="status-note">{error.message}</p>;
  // FasorX or the API down for a moment: a retry here beats reloading the page.
  if (error || !user)
    return (
      <p className="status-note">
        Não foi possível carregar sua sessão.{' '}
        <Button variant="secondary" size="compact" loading={isFetching} onClick={() => refetch()}>
          Tentar de novo
        </Button>
      </p>
    );
  return <Layout user={user} />;
}
