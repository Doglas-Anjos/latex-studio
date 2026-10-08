import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth-hooks';
import { Button } from '../components/button';
import { useService } from '../di/service-provider';
import { AdminServiceToken } from '../services/admin.service';
import type { User } from '../services/auth.service';

/** Platform governance: every user and their projects. Guarded by the API; the page also hides
 * itself from non-admins. */
export function AdminPage() {
  const me = useMe().data;
  const admin = useService(AdminServiceToken);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<User | null>(null);

  const users = useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: () => admin.listUsers(search.trim() ? { search: search.trim() } : {}),
    enabled: me?.isAdmin === true,
  });

  if (me && !me.isAdmin) {
    return (
      <div className="admin-denied">
        <ShieldAlert size={20} aria-hidden="true" />
        <p>Esta área é só para administradores da plataforma.</p>
        <Link to="/">Voltar aos projetos</Link>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>Administração</h1>
        <Link to="/" className="admin-back">
          Voltar aos projetos
        </Link>
      </header>
      <div className="admin-grid">
        <section className="admin-users" aria-label="Usuários">
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              placeholder="Buscar por nome ou e-mail"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {users.isPending && <p className="status-note">Carregando…</p>}
          {users.error && <p className="form-error">Erro ao carregar usuários.</p>}
          {users.data && (
            <>
              <p className="admin-count">{users.data.total} usuários</p>
              <ul className="admin-user-list">
                {users.data.items.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="admin-user"
                      data-active={selected?.id === u.id}
                      onClick={() => setSelected(u)}
                    >
                      <span className="admin-user-name">{u.name}</span>
                      <span className="admin-user-email muted">{u.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="admin-detail" aria-label="Projetos do usuário">
          {selected ? (
            <UserProjects user={selected} />
          ) : (
            <p className="status-note admin-empty">Selecione um usuário para ver os projetos.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function UserProjects({ user }: { user: User }) {
  const admin = useService(AdminServiceToken);
  const queryClient = useQueryClient();
  const projects = useQuery({
    queryKey: ['admin', 'projects', user.id],
    queryFn: () => admin.userProjects(user.id),
  });
  const remove = useMutation({
    mutationFn: (id: string) => admin.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'projects', user.id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  return (
    <div className="admin-detail-inner">
      <h2>
        {user.name} <span className="muted">· {user.email}</span>
      </h2>
      {projects.isPending && <p className="status-note">Carregando…</p>}
      {projects.data?.items.length === 0 && <p className="status-note">Nenhum projeto.</p>}
      <ul className="admin-project-list">
        {projects.data?.items.map((p) => (
          <li key={p.id}>
            <span className="admin-project-name" title={p.name}>
              {p.name}
            </span>
            <span className="admin-project-role muted">{p.role}</span>
            <Link to={`/projects/${p.id}`} className="btn btn-ghost btn-compact">
              <FolderOpen size={15} aria-hidden="true" /> Abrir
            </Link>
            <Button
              variant="ghost"
              size="compact"
              loading={remove.isPending && remove.variables === p.id}
              onClick={() => {
                if (confirm(`Excluir o projeto "${p.name}"? Isso não pode ser desfeito.`)) {
                  remove.mutate(p.id);
                }
              }}
            >
              <Trash2 size={15} aria-hidden="true" /> Excluir
            </Button>
          </li>
        ))}
      </ul>
      {remove.error && <p className="form-error">Erro ao excluir o projeto.</p>}
    </div>
  );
}
