import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../components/button';
import { LanguageToggle } from '../components/language-toggle';
import '../components/lan-share.css';
import { useService } from '../di/service-provider';
import { useDash, useLan } from '../i18n';
import { ApiError } from '../services/api-client';
import { LanServiceToken } from '../services/lan.service';
import { lanSession } from '../services/lan-session';
import { isProjectId } from '../services/project.service';

const isPin = (v: string) => /^\d{4}$/.test(v);

/** Public PIN-entry screen a LAN guest lands on via the shared link; on success it stores the token. */
export function JoinPage() {
  const { projectId = '' } = useParams();
  const lan = useService(LanServiceToken);
  const t = useLan();
  const d = useDash();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pin, setPin] = useState('');

  const join = useMutation({
    mutationFn: () => lan.join(projectId, pin),
    onSuccess: ({ token }) => {
      lanSession.set(token);
      // A new identity: drop everything cached for the previous one (a 401 "no session", or the
      // host's own data in the host's tab) so nothing renders under the wrong identity.
      queryClient.clear();
      navigate(`/projects/${projectId}`, { replace: true });
    },
  });
  const locked = join.error instanceof ApiError && join.error.status === 429;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isPin(pin) && !join.isPending) join.mutate();
  };

  if (!isProjectId(projectId))
    return (
      <main className="session-screen">
        <div className="session-lang">
          <LanguageToggle />
        </div>
        <p className="status-note">{d.needLink}</p>
      </main>
    );

  return (
    <main className="session-screen">
      <div className="session-lang">
        <LanguageToggle />
      </div>
      <form className="join-card" onSubmit={submit}>
        <span className="join-icon" aria-hidden="true">
          <KeyRound size={24} />
        </span>
        <h1>{t.joinTitle}</h1>
        <p>{t.joinDescription}</p>
        <input
          className="join-pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          aria-label={t.pinLabel}
        />
        {join.isError && (
          <p className="form-error" role="alert">
            {locked ? t.joinLocked : t.joinError}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={!isPin(pin) || join.isPending}
          loading={join.isPending}
        >
          {t.join}
        </Button>
      </form>
    </main>
  );
}
