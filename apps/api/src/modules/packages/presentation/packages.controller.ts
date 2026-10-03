import type { PackageManifest } from '@latex-studio/latex-tools';
import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../../auth/presentation/decorators';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
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

  @Put()
  @RequireProjectRole('editor')
  set(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Body() dto: SetPackagesDto,
  ): Promise<PackageManifest> {
    return this.packages.set(project, user, dto.packages);
  }

  @Post('migrate')
  @HttpCode(200)
  @RequireProjectRole('editor')
  migrate(@CurrentProject() project: Project, @CurrentUser() user: User) {
    return this.packages.migrate(project, user);
  }
}
