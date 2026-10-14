import { createBrowserRouter } from 'react-router';
import { RequireAuth } from './components/guards';
import { ProjectsPage } from './pages/projects-page';

// The project page (CodeMirror, PDF.js, d3) and admin load on first visit, not with the dashboard.
export const router = createBrowserRouter([
  {
    element: <RequireAuth />,
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
