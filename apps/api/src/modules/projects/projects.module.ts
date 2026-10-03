import { Module } from '@nestjs/common';
import { ProjectLock } from './application/project-lock';
import { ProjectsService } from './application/projects.service';
import { PROJECT_REPOSITORY } from './domain/project.repository';
import { PROJECT_STORAGE } from './domain/project-storage';
import { DrizzleProjectRepository } from './infrastructure/drizzle-project.repository';
import { FsProjectStorage } from './infrastructure/fs-project-storage';
import { ProjectsController } from './presentation/projects.controller';

@Module({
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ProjectLock,
    { provide: PROJECT_REPOSITORY, useClass: DrizzleProjectRepository },
    { provide: PROJECT_STORAGE, useClass: FsProjectStorage },
  ],
  // ProjectRoleGuard needs PROJECT_REPOSITORY wherever it is used.
  exports: [ProjectsService, PROJECT_REPOSITORY, PROJECT_STORAGE, ProjectLock],
})
export class ProjectsModule {}
