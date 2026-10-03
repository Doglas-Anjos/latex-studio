import { createBrowserRouter } from 'react-router';
import { RequireAdmin, RequireAuth } from './components/guards';
import { AdminUsersPage } from './pages/admin-users-page';
import { LoginPage } from './pages/login-page';
import { ProjectPage } from './pages/project-page';
import { ProjectsPage } from './pages/projects-page';
import { RegisterPage } from './pages/register-page';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <ProjectsPage /> },
      { path: '/projects/:projectId', element: <ProjectPage /> },
      {
        path: '/admin/users',
        element: (
          <RequireAdmin>
            <AdminUsersPage />
          </RequireAdmin>
        ),
      },
    ],
  },
]);
