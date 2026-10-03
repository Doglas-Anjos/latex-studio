import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { type AuditEntry, AuditService } from '../../audit/audit.service';
import { CurrentUser } from '../../auth/presentation/decorators';
import type { User } from '../../users/domain/user';
import { AdminService } from '../application/admin.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { ListUsersQuery, UpdateUserDto } from './admin.dto';
import { AdminGuard } from './guards/admin.guard';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get('audit')
  listAudit(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ): Promise<AuditEntry[]> {
    return this.audit.list(Math.min(Math.max(limit, 1), 500));
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQuery): Promise<User[]> {
    return this.admin.listUsers(query.status);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<User> {
    return this.admin.updateUser(actor, id, dto);
  }
}
