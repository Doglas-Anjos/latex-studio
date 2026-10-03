import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../components/button';
import { Form } from '../components/form';
import { useService } from '../di/service-provider';
import { AdminServiceToken } from '../services/admin.service';
import type { User } from '../services/auth.service';

type Status = User['status'];

const TABS: { status: Status; label: string }[] = [
  { status: 'pending', label: 'Pendentes' },
  { status: 'active', label: 'Ativos' },
  { status: 'blocked', label: 'Bloqueados' },
];

export function AdminUsersPage() {
  const admin = useService(AdminServiceToken);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('pending');
  const users = useQuery({
    queryKey: ['admin-users', status],
    queryFn: () => admin.listUsers(status),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; status: Status }) => admin.updateUser(v.id, { status: v.status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const act = (
    user: User,
    next: Status,
    label: string,
    variant: 'primary' | 'danger' | 'secondary',
  ) => (
    <Button
      variant={variant}
      disabled={update.isPending}
      onClick={() => update.mutate({ id: user.id, status: next })}
    >
      {label}
    </Button>
  );

  return (
    <>
      <div className="page-head">
        <h1>Usuários</h1>
      </div>
      <div role="tablist" className="tabs">
        {TABS.map((t) => (
          <button
            key={t.status}
            type="button"
            role="tab"
            aria-selected={status === t.status}
            onClick={() => setStatus(t.status)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {update.isError && <Form.Error>Não foi possível atualizar o usuário.</Form.Error>}
      <div className="card" role="tabpanel">
        {users.isPending && <p className="empty">Carregando…</p>}
        {users.isError && <p className="empty">Não foi possível carregar os usuários.</p>}
        {users.data?.length === 0 && <p className="empty">Nenhum usuário nesta lista.</p>}
        {users.data && users.data.length > 0 && (
          <ul className="user-list">
            {users.data.map((u) => (
              <li key={u.id}>
                <div>
                  <strong>{u.name}</strong>
                  <span className="muted">{u.email}</span>
                </div>
                <div className="actions">
                  {u.status === 'pending' && act(u, 'active', 'Aprovar', 'primary')}
                  {u.status !== 'blocked' && act(u, 'blocked', 'Bloquear', 'danger')}
                  {u.status === 'blocked' && act(u, 'active', 'Reativar', 'secondary')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
