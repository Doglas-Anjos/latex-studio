import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Trash2, Wifi } from 'lucide-react';
import { type FormEvent, type RefObject, useEffect, useState } from 'react';
import { useService } from '../di/service-provider';
import { useLan } from '../i18n';
import { LanServiceToken } from '../services/lan.service';
import { Button } from './button';
import { Dialog } from './dialog';
import './lan-share.css';

/**
 * Owner-only LAN share panel: publish the project, then hand each friend a link + a one-time PIN.
 * Shown instead of the FasorX invite dialog in local mode. The status query runs only while open.
 * `project` may be null so a list page can mount it before the first pick (showModal needs the node).
 */
export function LanShareDialog({
  dialogRef,
  project,
  open,
  onClose,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  project: { id: string; name: string } | null;
  open: boolean;
  onClose: () => void;
}) {
  const lan = useService(LanServiceToken);
  const t = useLan();
  const qc = useQueryClient();
  const id = project?.id ?? '';
  const queryKey = ['lan', id];
  const [alias, setAlias] = useState('');
  // A created PIN is returned once; keep it on screen (keyed by access id) until the dialog closes.
  const [pins, setPins] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState<string>();

  const { data } = useQuery({ queryKey, queryFn: () => lan.status(id), enabled: open && !!id });
  const invalidate = () => qc.invalidateQueries({ queryKey });

  const publish = useMutation({
    mutationFn: () => (data?.published ? lan.unpublish(id) : lan.publish(id)),
    onSuccess: invalidate,
  });
  const add = useMutation({
    mutationFn: () => lan.createAccess(id, alias.trim()),
    onSuccess: (acc) => {
      setPins((p) => ({ ...p, [acc.id]: acc.pin }));
      setAlias('');
      invalidate();
    },
  });
  const revoke = useMutation({
    mutationFn: (accessId: string) => lan.revoke(id, accessId),
    onSuccess: invalidate,
  });

  // Reset transient state whenever the dialog closes (cancel/Esc/X), and tell the parent.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const closed = () => {
      setPins({});
      setAlias('');
      setCopied(false);
      setOrigin(undefined);
      onClose();
    };
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialogRef, onClose]);

  // Several adapters (Wi-Fi, VPN, WSL) each get an address; only one may reach the friend.
  const base = origin ?? data?.urls[0];
  const link = base ? `${base}/join/${id}` : '';
  const copy = () => {
    if (!link) return;
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  const addPerson = (e: FormEvent) => {
    e.preventDefault();
    if (alias.trim() && !add.isPending) add.mutate();
  };

  return (
    <Dialog
      ref={dialogRef}
      title={t.title}
      icon={<Wifi size={18} aria-hidden="true" />}
      kicker={project?.name}
      description={t.description}
    >
      {data && !data.enabled && <p className="status-note">{t.disabled}</p>}
      {data?.enabled && (
        <div className="lan-share">
          <Button
            variant={data.published ? 'secondary' : 'primary'}
            onClick={() => publish.mutate()}
            loading={publish.isPending}
          >
            {data.published ? t.unpublish : t.publish}
          </Button>

          {data.published && (
            <>
              <label className="lan-share-link">
                <span className="lan-share-label">{t.link}</span>
                <span className="lan-share-link-row">
                  <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t.copy}
                    title={copied ? t.copied : t.copy}
                    onClick={copy}
                  >
                    {copied ? (
                      <Check size={16} aria-hidden="true" />
                    ) : (
                      <Copy size={16} aria-hidden="true" />
                    )}
                  </Button>
                </span>
              </label>
              {data.urls.length > 1 && (
                <>
                  <select
                    aria-label={t.pickUrl}
                    value={base}
                    onChange={(e) => setOrigin(e.target.value)}
                  >
                    {data.urls.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                  <small className="lan-share-note">{t.pickUrl}</small>
                </>
              )}

              <h3 className="lan-share-label">{t.people}</h3>
              <form className="lan-share-add" onSubmit={addPerson}>
                <input
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder={t.aliasPlaceholder}
                  maxLength={40}
                  aria-label={t.aliasPlaceholder}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={!alias.trim() || add.isPending}
                  loading={add.isPending}
                >
                  {t.add}
                </Button>
              </form>

              {data.access.length === 0 ? (
                <p className="lan-share-empty">{t.noPeople}</p>
              ) : (
                <ul className="lan-share-people">
                  {data.access.map((a) => (
                    <li key={a.id}>
                      <span className="lan-share-alias">{a.alias}</span>
                      {pins[a.id] && <code className="lan-share-pin">{pins[a.id]}</code>}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t.remove}
                        title={t.remove}
                        onClick={() => revoke.mutate(a.id)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {Object.keys(pins).length > 0 && (
                <small className="lan-share-note">{t.pinOnce}</small>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
