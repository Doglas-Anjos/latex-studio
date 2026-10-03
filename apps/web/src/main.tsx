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
import { HttpMemberService, MemberServiceToken } from './services/member.service';
import { HttpPackageService, PackageServiceToken } from './services/package.service';
import { HttpProjectService, ProjectServiceToken } from './services/project.service';
import { HttpToolsService, ToolsServiceToken } from './services/tools.service';
import './styles.css';

const api = new ApiClient();
const container = new Container()
  .register(AuthServiceToken, new HttpAuthService(api))
  .register(AdminServiceToken, new HttpAdminService(api))
  .register(ProjectServiceToken, new HttpProjectService(api))
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
