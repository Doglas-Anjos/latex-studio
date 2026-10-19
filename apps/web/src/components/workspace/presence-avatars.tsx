import { useWorkspaceStore } from '../../workspace-store';
import { peerSlot } from '../presence';
import { useMatchMedia } from './use-match-media';

/** One or two initials from a display name, for a presence circle. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Collaborators editing the open file right now, as Google-Docs-style initial circles in the
 * header. Deduped by account (two tabs of one person are one avatar) and capped with a "+N" — fewer
 * on a phone, where the header has no room. The circle colour comes from the account's palette slot.
 */
export function PresenceAvatars() {
  const peers = useWorkspaceStore((s) => s.peers);
  const phone = useMatchMedia('(max-width: 26rem)');
  const people = [...new Map(peers.map((p) => [p.userId, p])).values()];
  if (people.length === 0) return null;
  const shown = people.slice(0, phone ? 1 : 3);
  const extra = people.length - shown.length;
  return (
    <ul
      className="presence-avatars"
      aria-label={`Editando agora: ${people.map((p) => p.name).join(', ')}`}
    >
      {shown.map((p) => (
        <li
          key={p.userId}
          className="presence-avatar"
          style={{ background: `var(--peer-${peerSlot(p.userId) + 1})` }}
          title={`${p.name} está editando`}
        >
          {initials(p.name)}
        </li>
      ))}
      {extra > 0 && (
        <li className="presence-avatar presence-avatar-extra" title={`e mais ${extra}`}>
          +{extra}
        </li>
      )}
    </ul>
  );
}
