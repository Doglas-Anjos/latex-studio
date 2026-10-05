import { APP_CONFIG, type AppConfig, PROJECT_LOCK_REDIS, parseRedisUrl } from '@latex-studio/core';
import { forwardRef, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { CollabModule } from '../collab/collab.module';
import { ProjectLock } from './application/project-lock';
import { ProjectsService } from './application/projects.service';
import { PROJECT_REPOSITORY } from './domain/project.repository';
import { PROJECT_STORAGE } from './domain/project-storage';
import { DrizzleProjectRepository } from './infrastructure/drizzle-project.repository';
import { FsProjectStorage } from './infrastructure/fs-project-storage';
import { ProjectsController } from './presentation/projects.controller';

@Module({
  // CollabModule needs the project repository and storage; ProjectsService closes open docs.
  imports: [forwardRef(() => CollabModule)],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ProjectLock,
    {
      provide: PROJECT_LOCK_REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new Redis(parseRedisUrl(config.REDIS_URL)),
    },
    { provide: PROJECT_REPOSITORY, useClass: DrizzleProjectRepository },
    { provide: PROJECT_STORAGE, useClass: FsProjectStorage },
  ],
  // ProjectRoleGuard needs PROJECT_REPOSITORY wherever it is used.
  exports: [ProjectsService, PROJECT_REPOSITORY, PROJECT_STORAGE, ProjectLock],
})
export class ProjectsModule implements OnApplicationShutdown {
  constructor(@Inject(PROJECT_LOCK_REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
