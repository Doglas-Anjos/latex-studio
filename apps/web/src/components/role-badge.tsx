import { Eye, MessageSquareText, PencilLine } from 'lucide-react';
import type { Role } from '../services/project.service';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Dono',
  editor: 'Editor',
  reviewer: 'Revisor',
  viewer: 'Leitor',
};
export const ROLE_HINT = {
  editor: 'Edita arquivos, compila e comenta.',
  reviewer: 'Comenta e acompanha alterações, sem editar arquivos.',
  viewer: 'Apenas visualiza o projeto.',
} satisfies Record<Exclude<Role, 'owner'>, string>;
export const ROLE_ICON = { editor: PencilLine, reviewer: MessageSquareText, viewer: Eye };

export function RoleBadge({ role }: { role: Role }) {
  if (role === 'owner') return null;
  const Icon = ROLE_ICON[role];
  return (
    <span
      className="role-chip role-chip-static role-badge"
      data-role={role}
      title={ROLE_HINT[role]}
    >
      <Icon size={12} aria-hidden="true" />
      {ROLE_LABEL[role]}
    </span>
  );
}
