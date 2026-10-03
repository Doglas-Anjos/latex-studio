import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMe } from '../auth-hooks';
import { ApiError } from '../services/api-client';
import { Layout } from './layout';

export function RequireAuth() {
  const { data: user, error, isPending } = useMe();
  if (isPending) return <p className="status-note">Carregando…</p>;
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
  if (error || !user) return <p className="status-note">Não foi possível carregar sua sessão.</p>;
  return <Layout user={user} />;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { data: user } = useMe();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}
