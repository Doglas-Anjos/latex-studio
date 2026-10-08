import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2, UserPlus } from 'lucide-react';
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { useService } from '../di/service-provider';
import { type AssignableRole, type Member, MemberServiceToken } from '../services/member.service';
import { useWorkspaceStore } from '../workspace-store';
import { Button } from './button';
import { Dialog } from './dialog';
import { Form } from './form';

const ROLE_LABEL: Record<Member['role'], string> = {
  owner: 'Dono',
  editor: 'Editor',
  reviewer: 'Revisor',
  viewer: 'Leitor',
};
const ASSIGNABLE: AssignableRole[] = ['editor', 'reviewer', 'viewer'];
const ROLE_HINT: Record<AssignableRole, string> = {
  editor: 'Edita arquivos, compila e comenta.',
  reviewer: 'Comenta e acompanha alterações, sem editar arquivos.',
  viewer: 'Apenas visualiza o projeto.',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function MembersPanel({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const service = useService(MemberServiceToken);
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => service.list(projectId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members', projectId] });
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: AssignableRole }) =>
      service.setRole(projectId, v.userId, v.role),
    onSuccess: refresh,
  });
  const online = new Set(useWorkspaceStore((s) => s.peers).map((p) => p.name));
  const inviteRef = useRef<HTMLDialogElement>(null);
  const inviteEmailRef = useRef<HTMLInputElement>(null);
  const removeRef = useRef<HTMLDialogElement>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  // The dialog mounts closed, so autoFocus on the input never fires; focus it
  // explicitly once showModal has run (it otherwise lands on the X button).
  const openInvite = () => {
    inviteRef.current?.showModal();
    inviteEmailRef.current?.focus();
  };

  const askRemove = (m: Member) => {
    setRemoving(m);
    removeRef.current?.showModal();
  };

  return (
    <section className="members-panel" aria-label="Membros">
      {isOwner && (
        <div className="members-toolbar">
          <Button variant="primary" size="compact" onClick={openInvite}>
            <UserPlus size={14} aria-hidden="true" /> Convidar membro
          </Button>
        </div>
      )}

      {members.isPending && <p className="status-note">Carregando membros…</p>}

      {members.isError && (
        <p className="alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Não foi possível carregar os membros.</span>
          <Button variant="ghost" size="compact" onClick={() => members.refetch()}>
            Tentar de novo
          </Button>
        </p>
      )}

      {members.data && members.data.length === 0 && (
        <p className="muted empty">Nenhum membro ainda.</p>
      )}

      {members.data && members.data.length > 0 && (
        <ul className="member-list">
          {members.data.map((m) => (
            <li key={m.userId} className="member-item">
              <span className="member-avatar" aria-hidden="true">
                {initials(m.name)}
              </span>
              <span className="member-info">
                <span className="member-name" title={m.name}>
                  {m.name}
                  {online.has(m.name) && <span className="online-dot" title="Online" />}
                </span>
                {m.email && (
                  <span className="member-email muted" title={m.email}>
                    {m.email}
                  </span>
                )}
              </span>
              <span className="member-role-row">
                {isOwner && m.role !== 'owner' ? (
                  <select
                    className="role-chip"
                    aria-label={`Papel de ${m.name}`}
                    value={m.role}
                    disabled={setRole.isPending}
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
                ) : (
                  <span className="role-chip role-chip-static">{ROLE_LABEL[m.role]}</span>
                )}
                {isOwner && m.role !== 'owner' && (
                  <Button
                    variant="ghost"
                    size="compact"
                    aria-label={`Remover ${m.name}`}
                    title={`Remover ${m.name}`}
                    onClick={() => askRemove(m)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {setRole.error && <p className="form-error">{setRole.error.message}</p>}

      <InviteDialog
        dialogRef={inviteRef}
        emailRef={inviteEmailRef}
        projectId={projectId}
        onDone={refresh}
      />
      <RemoveMemberDialog
        dialogRef={removeRef}
        projectId={projectId}
        member={removing}
        onDone={refresh}
      />
    </section>
  );
}

function InviteDialog({
  dialogRef,
  emailRef,
  projectId,
  onDone,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  emailRef: RefObject<HTMLInputElement | null>;
  projectId: string;
  onDone: () => void;
}) {
  const service = useService(MemberServiceToken);
  const formId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('editor');
  const invite = useMutation({
    mutationFn: () => service.invite(projectId, email.trim(), role),
    onSuccess: () => {
      dialogRef.current?.close();
      setEmail('');
      setRole('editor');
      onDone();
    },
  });

  // Only clears on close (cancel/Esc), never on a failed submit: the dialog
  // stays open then and the decision maker's input must survive.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const reset = () => {
      setEmail('');
      setRole('editor');
      invite.reset();
    };
    dialog.addEventListener('close', reset);
    return () => dialog.removeEventListener('close', reset);
  }, [dialogRef, invite]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (invite.isPending) return;
    invite.mutate();
  };

  return (
    <Dialog
      ref={dialogRef}
      title="Convidar membro"
      icon={<UserPlus size={18} aria-hidden="true" />}
      kicker="Novo convite"
      description="A pessoa recebe acesso imediato ao projeto com o papel escolhido abaixo."
      pending={invite.isPending}
      footer={
        <div className="actions">
          <Dialog.Cancel />
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={invite.isPending || !email.trim()}
            loading={invite.isPending}
          >
            {invite.isPending ? 'Enviando…' : 'Enviar convite'}
          </Button>
        </div>
      }
    >
      <Form id={formId} onSubmit={submit}>
        <Form.Field
          ref={emailRef}
          label="E-mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="pessoa@exemplo.com"
          required
        />
        <fieldset className="role-options">
          <legend>Papel</legend>
          {ASSIGNABLE.map((r) => (
            <label key={r} className="role-option" data-selected={role === r}>
              <input
                type="radio"
                name="role"
                value={r}
                checked={role === r}
                onChange={() => setRole(r)}
              />
              <span className="role-option-main">
                <span className="role-option-label">{ROLE_LABEL[r]}</span>
                <span className="role-option-hint">{ROLE_HINT[r]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {invite.error && <Form.Error>{invite.error.message}</Form.Error>}
      </Form>
    </Dialog>
  );
}

function RemoveMemberDialog({
  dialogRef,
  projectId,
  member,
  onDone,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  projectId: string;
  member: Member | null;
  onDone: () => void;
}) {
  const service = useService(MemberServiceToken);
  const remove = useMutation({
    mutationFn: () => service.remove(projectId, member?.userId ?? ''),
    onSuccess: () => {
      dialogRef.current?.close();
      onDone();
    },
  });
  // `member` changes before the dialog repaints (showModal is called synchronously
  // right after setState); reset the mutation here instead of via a remount key.
  const [lastMember, setLastMember] = useState(member);
  if (member !== lastMember) {
    setLastMember(member);
    remove.reset();
  }

  return (
    <Dialog
      ref={dialogRef}
      title="Remover membro"
      icon={<Trash2 size={18} aria-hidden="true" />}
      kicker={member?.email}
      description={`Remover ${member?.name} deste projeto? A pessoa perde o acesso imediatamente.`}
      tone="danger"
      pending={remove.isPending}
      footer={
        <div className="actions">
          <Dialog.Cancel />
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending ? 'Removendo…' : 'Remover'}
          </Button>
        </div>
      }
    >
      {remove.error && <Form.Error>{remove.error.message}</Form.Error>}
    </Dialog>
  );
}
