import { Link, Outlet } from 'react-router';
import { useService } from '../di/service-provider';
import type { User } from '../services/auth.service';
import { IdentityToken } from '../services/identity';
import { Button } from './button';
import { ThemeToggle } from './theme-toggle';
import { useApplyTheme } from './use-theme';

export function Layout({ user }: { user: User }) {
  const identity = useService(IdentityToken);
  useApplyTheme();
  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          LaTeX Studio
        </Link>
        <nav>
          <ThemeToggle />
          <span className="user-email">{user.name || user.email}</span>
          {identity.enabled && (
            <Button variant="ghost" onClick={() => identity.signOut()}>
              Sair
            </Button>
          )}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}
