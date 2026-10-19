import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMe } from '../auth-hooks';
import { useService } from '../di/service-provider';
import { useDash } from '../i18n';
import { ApiError } from '../services/api-client';
import { IdentityToken } from '../services/identity';
import { lanSession } from '../services/lan-session';
import { Button } from './button';
import { LanguageToggle } from './language-toggle';
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
  if (error || !user) {
    const projectId = location.pathname.match(/\/projects\/([^/]+)/)?.[1];
    // A 401 in local mode means "no session": a LAN guest who must enter (or re-enter) a PIN.
    // Anything else is the server being unreachable, where retrying in place is the right move.
    const needsPin = error instanceof ApiError && error.status === 401;
    return (
      <div className="session-screen">
        <div className="session-lang">
          <LanguageToggle />
        </div>
        {needsPin ? (
          <>
            <p className="status-note">{projectId ? d.needPin : d.needLink}</p>
            {projectId && (
              <Button
                variant="primary"
                onClick={() => {
                  lanSession.clear();
                  navigate(`/join/${projectId}`);
                }}
              >
                {d.enterPin}
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="status-note">{d.serverError}</p>
            <Button variant="secondary" loading={isFetching} onClick={() => refetch()}>
              {d.tryAgain}
            </Button>
          </>
        )}
      </div>
    );
  }
  return <Layout user={user} />;
}
