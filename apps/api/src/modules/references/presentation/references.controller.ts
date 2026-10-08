import { Controller, Get, Inject } from '@nestjs/common';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import { ReferencesService } from '../application/references.service';

@Controller('projects/:projectId/references')
export class ReferencesController {
  constructor(@Inject(ReferencesService) private readonly references: ReferencesService) {}

  @Get()
  @RequireProjectRole('viewer')
  index(@CurrentProject() project: Project) {
    return this.references.index(project);
  }
}
