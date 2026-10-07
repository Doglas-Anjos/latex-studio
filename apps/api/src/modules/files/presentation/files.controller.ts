import { basename, extname } from 'node:path/posix';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../auth/presentation/decorators';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import { UPLOAD_RATE_LIMIT, withParts } from '../../projects/presentation/multipart';
import type { User } from '../../users/domain/user';
import { FilesService, type UploadedFile } from '../application/files.service';
import { CONTENT_TYPES } from './content-types';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { CreateFileDto, CreateFolderDto, RenameFileDto, UpdateFileDto } from './files.dto';

@Controller('projects/:projectId')
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Get('files')
  @RequireProjectRole('viewer')
  list(@CurrentProject() project: Project): Promise<Array<{ path: string; size: number }>> {
    return this.files.list(project);
  }

  @Get('files/*')
  @RequireProjectRole('viewer')
  @Header('X-Content-Type-Options', 'nosniff')
  // Opened directly, a PDF or image cannot run script or reach the session's origin.
  @Header('Content-Security-Policy', 'sandbox')
  async read(
    @CurrentProject() project: Project,
    @Param('*') path: string,
  ): Promise<StreamableFile> {
    const content = await this.files.read(project, path);
    const type = CONTENT_TYPES[extname(path).toLowerCase()];
    if (type) return new StreamableFile(content, { type });
    // SafePath limits names to [A-Za-z0-9._ -()], so the filename needs no escaping.
    return new StreamableFile(content, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${basename(path)}"`,
    });
  }

  @Post('files')
  @RequireProjectRole('editor')
  create(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Body() dto: CreateFileDto,
  ): Promise<void> {
    return this.files.create(project, user, dto.path, dto.content);
  }

  @Post('files/rename')
  @RequireProjectRole('editor')
  @HttpCode(204)
  rename(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Body() dto: RenameFileDto,
  ): Promise<void> {
    return this.files.rename(project, user, dto.from, dto.to);
  }

  @Put('files/*')
  @RequireProjectRole('editor')
  @HttpCode(204)
  update(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Param('*') path: string,
    @Body() dto: UpdateFileDto,
  ): Promise<void> {
    return this.files.update(project, user, path, dto.content);
  }

  @Delete('files/*')
  @RequireProjectRole('editor')
  @HttpCode(204)
  remove(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Param('*') path: string,
  ): Promise<void> {
    return this.files.remove(project, user, path);
  }

  @Post('folders')
  @RequireProjectRole('editor')
  createFolder(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Body() dto: CreateFolderDto,
  ): Promise<void> {
    return this.files.createFolder(project, user, dto.path);
  }

  @RouteConfig(UPLOAD_RATE_LIMIT)
  @Post('upload')
  @RequireProjectRole('editor')
  upload(
    @CurrentProject() project: Project,
    @Req() request: FastifyRequest,
  ): Promise<UploadedFile[]> {
    return withParts(request, (parts) => this.files.upload(project, parts));
  }
}
