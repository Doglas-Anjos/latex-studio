import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Container } from './di/container';
import { ServiceProvider } from './di/service-provider';
import { router } from './routes';
import { AdminServiceToken, HttpAdminService } from './services/admin.service';
import { ApiClient } from './services/api-client';
import { AuthServiceToken, HttpAuthService } from './services/auth.service';
import { CommentServiceToken, HttpCommentService } from './services/comment.service';
import { CompileServiceToken, HttpCompileService } from './services/compile.service';
import { FileServiceToken, HttpFileService } from './services/file.service';
import { HistoryServiceToken, HttpHistoryService } from './services/history.service';
import { FasorxIdentity, IdentityToken } from './services/identity';
import { HttpMemberService, MemberServiceToken } from './services/member.service';
import { HttpPackageService, PackageServiceToken } from './services/package.service';
import { HttpProjectService, ProjectServiceToken } from './services/project.service';
import { HttpReferenceService, ReferenceServiceToken } from './services/reference.service';
import { HttpToolsService, ToolsServiceToken } from './services/tools.service';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/fira-code/latin-400.css';
import '@fontsource/fira-code/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import './styles.css';
import './redesign.css';
import './dashboard.css';

const identity = new FasorxIdentity({
  url: import.meta.env.VITE_FASORX_URL ?? '',
  app: import.meta.env.VITE_FASORX_APP ?? 'latex',
});
const api = new ApiClient(identity);
const container = new Container()
  .register(AuthServiceToken, new HttpAuthService(api))
  .register(AdminServiceToken, new HttpAdminService(api))
  .register(IdentityToken, identity)
  .register(ProjectServiceToken, new HttpProjectService(api))
  .register(ReferenceServiceToken, new HttpReferenceService(api))
  .register(FileServiceToken, new HttpFileService(api))
  .register(CompileServiceToken, new HttpCompileService(api))
  .register(PackageServiceToken, new HttpPackageService(api))
  .register(CommentServiceToken, new HttpCommentService(api))
  .register(HistoryServiceToken, new HttpHistoryService(api))
  .register(ToolsServiceToken, new HttpToolsService(api))
  .register(MemberServiceToken, new HttpMemberService(api));
const queryClient = new QueryClient();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <ServiceProvider container={container}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ServiceProvider>
  </StrictMode>,
);
