import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from 'react-router';
import { useService } from '../di/service-provider';
import { AuthServiceToken, type User } from '../services/auth.service';
import { Button } from './button';

export function Layout({ user }: { user: User }) {
  const auth = useService(AuthServiceToken);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => auth.logout(),
    onSettled: () => {
      queryClient.clear();
      navigate('/login');
    },
  });

  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          LaTeX Studio
        </Link>
        <nav>
          {user.role === 'admin' && <Link to="/admin/users">Admin</Link>}
          <span className="user-email">{user.email}</span>
          <Button variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
            Sair
          </Button>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}
