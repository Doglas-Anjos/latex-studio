import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../auth/presentation/decorators';
import type { User } from '../../users/domain/user';
import { ProjectsService } from '../application/projects.service';
import type { Project, ProjectWithRole } from '../domain/project';
import { CurrentProject, RequireProjectRole } from './guards/project-role.guard';
import { IMPORT_RATE_LIMIT, withParts } from './multipart';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { CreateProjectDto } from './projects.dto';

@Controller('projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateProjectDto): Promise<Project> {
    return this.projects.create(user, dto.name);
  }

  @RouteConfig(IMPORT_RATE_LIMIT)
  @Post('import')
  import(@CurrentUser() user: User, @Req() request: FastifyRequest): Promise<Project> {
    return withParts(request, (parts) => this.projects.import(user, parts));
  }

  @Get()
  list(@CurrentUser() user: User): Promise<ProjectWithRole[]> {
    return this.projects.listForUser(user);
  }

  @Get(':projectId')
  @RequireProjectRole('viewer')
  get(@Req() request: FastifyRequest, @CurrentProject() project: Project): ProjectWithRole {
    return { ...project, role: request.projectRole ?? 'viewer' };
  }

  @Delete(':projectId')
  @RequireProjectRole('owner')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @CurrentProject() project: Project): Promise<void> {
    return this.projects.remove(project, user);
  }
}
