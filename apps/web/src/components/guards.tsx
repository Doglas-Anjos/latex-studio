import { useEffect } from 'react';
import { useMe } from '../auth-hooks';
import { useService } from '../di/service-provider';
import { ApiError } from '../services/api-client';
import { IdentityToken } from '../services/identity';
import { Layout } from './layout';

export function RequireAuth() {
  const identity = useService(IdentityToken);
  const { data: user, error, isPending } = useMe();
  useEffect(() => identity.watch(() => identity.goToLogin()), [identity]);
  const unauthorized = error instanceof ApiError && error.status === 401 && identity.enabled;
  useEffect(() => {
    if (unauthorized) identity.goToLogin();
  }, [unauthorized, identity]);
  if (isPending) return <p className="status-note">Carregando…</p>;
  if (unauthorized) return <p className="status-note">Entrando…</p>;
  if (error || !user) return <p className="status-note">Não foi possível carregar sua sessão.</p>;
  return <Layout user={user} />;
}
