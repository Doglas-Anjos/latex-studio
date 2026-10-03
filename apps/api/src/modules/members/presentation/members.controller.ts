import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { Project } from '../../projects/domain/project';
import type { Member } from '../../projects/domain/project.repository';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import { MembersService } from '../application/members.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { InviteDto, SetRoleDto } from './members.dto';

@Controller('projects/:projectId/members')
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get()
  @RequireProjectRole('viewer')
  list(@CurrentProject() project: Project): Promise<Member[]> {
    return this.members.list(project);
  }

  @Post()
  @RequireProjectRole('owner')
  invite(@CurrentProject() project: Project, @Body() dto: InviteDto): Promise<Member[]> {
    return this.members.invite(project, dto.email, dto.role);
  }

  @Patch(':userId')
  @RequireProjectRole('owner')
  setRole(
    @CurrentProject() project: Project,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetRoleDto,
  ): Promise<Member[]> {
    return this.members.setRole(project, userId, dto.role);
  }

  @Delete(':userId')
  @RequireProjectRole('owner')
  @HttpCode(204)
  remove(
    @CurrentProject() project: Project,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.members.remove(project, userId);
  }
}
