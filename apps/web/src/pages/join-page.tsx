import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../components/button';
import '../components/lan-share.css';
import { useService } from '../di/service-provider';
import { useLan } from '../i18n';
import { LanServiceToken } from '../services/lan.service';
import { lanSession } from '../services/lan-session';

const isPin = (v: string) => /^\d{4}$/.test(v);

/** Public PIN-entry screen a LAN guest lands on via the shared link; on success it stores the token. */
export function JoinPage() {
  const { projectId = '' } = useParams();
  const lan = useService(LanServiceToken);
  const t = useLan();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');

  const join = useMutation({
    mutationFn: () => lan.join(projectId, pin),
    onSuccess: ({ token }) => {
      lanSession.set(token);
      navigate(`/projects/${projectId}`, { replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isPin(pin) && !join.isPending) join.mutate();
  };

  return (
    <main className="join-page">
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
          <p className="join-error" role="alert">
            {t.joinError}
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
