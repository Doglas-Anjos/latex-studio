import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useService } from '../di/service-provider';
import { type AssignableRole, type Member, MemberServiceToken } from '../services/member.service';
import { useWorkspaceStore } from '../workspace-store';
import { Button } from './button';
import { Form } from './form';

const ROLE_LABEL: Record<Member['role'], string> = {
  owner: 'Dono',
  editor: 'Editor',
  reviewer: 'Revisor',
  viewer: 'Leitor',
};
const ASSIGNABLE: AssignableRole[] = ['editor', 'reviewer', 'viewer'];

export function MembersPanel({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const service = useService(MemberServiceToken);
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => service.list(projectId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members', projectId] });
  const invite = useMutation({
    mutationFn: (v: { email: string; role: AssignableRole }) =>
      service.invite(projectId, v.email, v.role),
    onSuccess: refresh,
  });
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: AssignableRole }) =>
      service.setRole(projectId, v.userId, v.role),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => service.remove(projectId, userId),
    onSuccess: refresh,
  });
  const online = new Set(useWorkspaceStore((s) => s.peers).map((p) => p.name));
  const error = invite.error ?? setRole.error ?? remove.error;

  return (
    <section className="members-panel" aria-label="Membros">
      <ul className="member-list">
        {(members.data ?? []).map((m) => (
          <li key={m.userId} className="member-item">
            <div>
              <strong>{m.name}</strong>
              {/* ponytail: matches awareness by display name; two members sharing a name both show online. Key awareness by user id to fix. */}
              {online.has(m.name) && (
                <span className="online" title="online">
                  ●
                </span>
              )}
              <span className="muted">{m.email}</span>
            </div>
            {isOwner && m.role !== 'owner' ? (
              <div className="actions">
                <select
                  aria-label={`Papel de ${m.name}`}
                  value={m.role}
                  onChange={(e) =>
                    setRole.mutate({ userId: m.userId, role: e.target.value as AssignableRole })
                  }
                >
                  {ASSIGNABLE.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" onClick={() => remove.mutate(m.userId)}>
                  Remover
                </Button>
              </div>
            ) : (
              <span className="muted">{ROLE_LABEL[m.role]}</span>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            invite.mutate({
              email: String(data.get('email')),
              role: String(data.get('role')) as AssignableRole,
            });
            e.currentTarget.reset();
          }}
        >
          <Form.Field label="Convidar por e-mail" name="email" type="email" required />
          <label className="field">
            <span>Papel</span>
            <select name="role" defaultValue="editor">
              {ASSIGNABLE.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          {error && <Form.Error>{error.message}</Form.Error>}
          <Button variant="secondary" type="submit" disabled={invite.isPending}>
            Convidar
          </Button>
        </Form>
      )}
    </section>
  );
}
