import { Controller, Get, Inject } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import { ReferencesService } from '../application/references.service';

@Controller('projects/:projectId/references')
export class ReferencesController {
  constructor(@Inject(ReferencesService) private readonly references: ReferencesService) {}

  // Each call reads and parses up to 4 MB of the project on the event loop: throttled per route.
  @RouteConfig({ rateLimit: { max: 60, timeWindow: '1 minute' } })
  @Get()
  @RequireProjectRole('viewer')
  index(@CurrentProject() project: Project) {
    return this.references.index(project);
  }

  @RouteConfig({ rateLimit: { max: 60, timeWindow: '1 minute' } })
  @Get('outline')
  @RequireProjectRole('viewer')
  outline(@CurrentProject() project: Project) {
    return this.references.outline(project);
  }

  // The graph view polls every 30 s and after typing pauses (5 s): ~14 a minute per open tab.
  @RouteConfig({ rateLimit: { max: 30, timeWindow: '1 minute' } })
  @Get('topics')
  @RequireProjectRole('viewer')
  topics(@CurrentProject() project: Project) {
    return this.references.topics(project);
  }
}
