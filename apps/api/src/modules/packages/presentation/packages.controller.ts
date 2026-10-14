import type { PackageManifest } from '@latex-studio/latex-tools';
import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { CurrentUser } from '../../auth/presentation/decorators';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import { WRITE_RATE_LIMIT } from '../../projects/presentation/multipart';
import type { User } from '../../users/domain/user';
import { PackagesService } from '../application/packages.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { SetPackagesDto } from './packages.dto';

@Controller('projects/:projectId/packages')
export class PackagesController {
  constructor(@Inject(PackagesService) private readonly packages: PackagesService) {}

  @Get()
  @RequireProjectRole('viewer')
  get(@CurrentProject() project: Project): Promise<PackageManifest> {
    return this.packages.get(project);
  }

  @Get('usage')
  @RequireProjectRole('viewer')
  usage(@CurrentProject() project: Project) {
    return this.packages.usage(project);
  }

  // Both writes commit, like a whole-file update.
  @RouteConfig(WRITE_RATE_LIMIT)
  @Put()
  @RequireProjectRole('editor')
  set(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Body() dto: SetPackagesDto,
  ): Promise<PackageManifest> {
    return this.packages.set(project, user, dto.packages);
  }

  @RouteConfig(WRITE_RATE_LIMIT)
  @Post('migrate')
  @HttpCode(200)
  @RequireProjectRole('editor')
  migrate(@CurrentProject() project: Project, @CurrentUser() user: User) {
    return this.packages.migrate(project, user);
  }
}
