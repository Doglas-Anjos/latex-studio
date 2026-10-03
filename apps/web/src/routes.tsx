import { createBrowserRouter } from 'react-router';
import { RequireAuth } from './components/guards';
import { ProjectPage } from './pages/project-page';
import { ProjectsPage } from './pages/projects-page';

export const router = createBrowserRouter([
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <ProjectsPage /> },
      { path: '/projects/:projectId', element: <ProjectPage /> },
    ],
  },
]);
