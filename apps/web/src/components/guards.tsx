import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMe } from '../auth-hooks';
import { useService } from '../di/service-provider';
import { useDash } from '../i18n';
import { ApiError } from '../services/api-client';
import { IdentityToken } from '../services/identity';
import { lanSession } from '../services/lan-session';
import { Button } from './button';
import { Layout } from './layout';

export function RequireAuth() {
  const identity = useService(IdentityToken);
  const d = useDash();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: user, error, isPending, isFetching, refetch } = useMe();
  // FasorX says the session ended: straight to its login, no breaker (it only sends people back
  // once they have a session, so there is no loop; the breaker here read a fresh login as one).
  useEffect(() => identity.watch(() => identity.goToLogin()), [identity]);
  if (isPending) return <p className="status-note">{d.loading}</p>;
  // The API client already went to log in ("Entrando…"), or says why it did not.
  if (error instanceof ApiError && error.status === 401 && identity.enabled)
    return <p className="status-note">{error.message}</p>;
  // FasorX or the API down for a moment: a retry here beats reloading the page. A LAN guest whose
  // session failed can re-enter their PIN instead (when the URL still carries the project id).
  if (error || !user) {
    const projectId = location.pathname.match(/\/projects\/([^/]+)/)?.[1];
    return (
      <p className="status-note">
        {d.sessionError}{' '}
        <Button variant="secondary" size="compact" loading={isFetching} onClick={() => refetch()}>
          {d.tryAgain}
        </Button>{' '}
        {projectId && (
          <Button
            variant="primary"
            size="compact"
            onClick={() => {
              lanSession.clear();
              navigate(`/join/${projectId}`);
            }}
          >
            {d.joinAgain}
          </Button>
        )}
      </p>
    );
  }
  return <Layout user={user} />;
}
