import { useEffect, useState } from 'react';
import { useMe } from '../auth-hooks';
import { useService } from '../di/service-provider';
import { ApiError } from '../services/api-client';
import { IdentityToken } from '../services/identity';
import { Layout } from './layout';

export function RequireAuth() {
  const identity = useService(IdentityToken);
  const { data: user, error, isPending } = useMe();
  // Guarded: a login page that bounces straight back would otherwise loop forever.
  useEffect(() => identity.watch(() => identity.goToLoginGuarded()), [identity]);
  const unauthorized = error instanceof ApiError && error.status === 401 && identity.enabled;
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (unauthorized && !identity.goToLoginGuarded()) setStuck(true);
  }, [unauthorized, identity]);
  if (isPending) return <p className="status-note">Carregando…</p>;
  if (unauthorized) return <p className="status-note">{stuck ? error.message : 'Entrando…'}</p>;
  if (error || !user) return <p className="status-note">Não foi possível carregar sua sessão.</p>;
  return <Layout user={user} />;
}
