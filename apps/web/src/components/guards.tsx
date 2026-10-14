import { useEffect, useState } from 'react';
import { useMe } from '../auth-hooks';
import { useService } from '../di/service-provider';
import { ApiError } from '../services/api-client';
import { IdentityToken } from '../services/identity';
import { Button } from './button';
import { Layout } from './layout';

export function RequireAuth() {
  const identity = useService(IdentityToken);
  const { data: user, error, isPending, isFetching, refetch } = useMe();
  // Guarded: a login page that bounces straight back would otherwise loop forever.
  useEffect(() => identity.watch(() => identity.goToLoginGuarded()), [identity]);
  const unauthorized = error instanceof ApiError && error.status === 401 && identity.enabled;
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (unauthorized && !identity.goToLoginGuarded()) setStuck(true);
  }, [unauthorized, identity]);
  if (isPending) return <p className="status-note">Carregando…</p>;
  if (unauthorized) return <p className="status-note">{stuck ? error.message : 'Entrando…'}</p>;
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
