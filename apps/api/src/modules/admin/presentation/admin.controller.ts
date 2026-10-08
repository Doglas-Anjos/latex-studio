import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/presentation/decorators';
import type { User } from '../../users/domain/user';
import { AdminService } from '../application/admin.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { ListUsersDto, UserProjectsDto } from './admin.dto';
import { AdminGuard } from './admin.guard';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get('users')
  users(@Query() dto: ListUsersDto) {
    return this.admin.listUsers(dto);
  }

  @Get('users/:userId/projects')
  userProjects(@Param('userId', ParseUUIDPipe) userId: string, @Query() dto: UserProjectsDto) {
    return this.admin.userProjects(userId, dto.limit ?? 50);
  }

  @Delete('projects/:projectId')
  @HttpCode(204)
  deleteProject(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentUser() actor: User) {
    return this.admin.deleteProject(projectId, actor);
  }
}
