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
  Req,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/presentation/decorators';
import type { Project, ProjectRole } from '../../projects/domain/project';
import type { Member } from '../../projects/domain/project.repository';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import type { User } from '../../users/domain/user';
import { MembersService } from '../application/members.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { InviteDto, SetRoleDto } from './members.dto';

@Controller('projects/:projectId/members')
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get()
  @RequireProjectRole('viewer')
  async list(
    @CurrentProject() project: Project,
    @Req() request: { projectRole?: ProjectRole },
  ): Promise<Array<Omit<Member, 'email'> & { email?: string }>> {
    const members = await this.members.list(project);
    // Addresses are for the owner, who manages membership; collaborators see names and roles.
    return request.projectRole === 'owner' ? members : members.map(({ email: _, ...m }) => m);
  }

  @Post()
  @RequireProjectRole('owner')
  invite(
    @CurrentProject() project: Project,
    @CurrentUser() actor: User,
    @Body() dto: InviteDto,
  ): Promise<Member[]> {
    return this.members.invite(project, actor.id, dto.email, dto.role);
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
    @CurrentUser() actor: User,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.members.remove(project, actor.id, userId);
  }
}
