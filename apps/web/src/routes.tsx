import { createBrowserRouter } from 'react-router';
import { Button } from './components/button';
import { RequireAuth } from './components/guards';
import { ProjectsPage } from './pages/projects-page';

// After a deploy, a tab opened earlier asks for chunks that no longer exist: reload once to get
// the new build (at most once a minute, so a real outage shows RouteError instead of looping).
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (Date.now() - Number(sessionStorage.getItem('chunkReload') ?? 0) < 60_000) return;
    sessionStorage.setItem('chunkReload', String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});

function RouteError() {
  return (
    <p className="status-note" role="alert">
      Não foi possível abrir esta página.{' '}
      <Button variant="secondary" size="compact" onClick={() => location.reload()}>
        Recarregar
      </Button>
    </p>
  );
}

// The project page (CodeMirror, PDF.js, d3) and admin load on first visit, not with the dashboard.
export const router = createBrowserRouter([
  // Public: a LAN guest enters their PIN here (no session yet), then is sent to the project.
  {
    path: '/join/:projectId',
    errorElement: <RouteError />,
    lazy: async () => ({ Component: (await import('./pages/join-page')).JoinPage }),
  },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <p className="status-note">Carregando…</p>,
    children: [
      { path: '/', element: <ProjectsPage /> },
      {
        path: '/projects/:projectId',
        lazy: async () => ({ Component: (await import('./pages/project-page')).ProjectPage }),
      },
      {
        path: '/admin',
        lazy: async () => ({ Component: (await import('./pages/admin-page')).AdminPage }),
      },
    ],
  },
]);
