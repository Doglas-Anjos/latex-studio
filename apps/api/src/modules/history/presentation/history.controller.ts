import { basename, extname } from 'node:path/posix';
import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  Inject,
  ParseIntPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { CurrentUser } from '../../auth/presentation/decorators';
import { CONTENT_TYPES } from '../../files/presentation/content-types';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import type { User } from '../../users/domain/user';
import { HistoryService } from '../application/history.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { CommitDto, CommitFileDto, RestoreDto } from './history.dto';

@Controller('projects/:projectId/history')
export class HistoryController {
  constructor(@Inject(HistoryService) private readonly history: HistoryService) {}

  @RouteConfig({ rateLimit: { max: 60, timeWindow: '1 minute' } })
  @Get()
  @RequireProjectRole('viewer')
  log(
    @CurrentProject() project: Project,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.history.log(project, Math.min(Math.max(limit, 1), 200));
  }

  @RouteConfig({ rateLimit: { max: 60, timeWindow: '1 minute' } })
  @Get('changes')
  @RequireProjectRole('viewer')
  changes(
    @CurrentProject() project: Project,
    @Query('from') from: string = '',
    @Query('to') to: string = '',
  ) {
    return this.history.changes(project, from, to);
  }

  @RouteConfig({ rateLimit: { max: 120, timeWindow: '1 minute' } })
  @Get('status')
  @RequireProjectRole('viewer')
  status(@CurrentProject() project: Project) {
    return this.history.status(project);
  }

  @RouteConfig({ rateLimit: { max: 30, timeWindow: '1 minute' } })
  @Get('file-log')
  @RequireProjectRole('viewer')
  fileLog(
    @CurrentProject() project: Project,
    @Query('path') path: string = '',
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.history.fileLog(project, path, Math.min(Math.max(limit, 1), 200));
  }

  @Get('blame')
  @RouteConfig({ rateLimit: { max: 30, timeWindow: '1 minute' } })
  @RequireProjectRole('viewer')
  blame(@CurrentProject() project: Project, @Query('path') path: string = '') {
    return this.history.blame(project, path);
  }

  @Get('file')
  @RequireProjectRole('viewer')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', 'sandbox')
  async file(
    @CurrentProject() project: Project,
    @Query('sha') sha = '',
    @Query('path') path: string = '',
  ): Promise<StreamableFile> {
    const content = await this.history.fileAt(project, sha, path);
    const type = CONTENT_TYPES[extname(path).toLowerCase()];
    // Only text is served inline here; images and PDFs of old versions download.
    if (type?.startsWith('text/')) return new StreamableFile(content, { type });
    // SafePath limits names to [A-Za-z0-9._ -()], so the filename needs no escaping.
    return new StreamableFile(content, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${basename(path)}"`,
    });
  }

  @Post('commit')
  @RequireProjectRole('editor')
  commit(@CurrentProject() project: Project, @CurrentUser() user: User, @Body() dto: CommitDto) {
    return this.history.commit(project, user, dto.message, dto.paths);
  }

  @Post('commit-file')
  @RequireProjectRole('editor')
  commitFile(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Body() dto: CommitFileDto,
  ) {
    return this.history.commitFile(project, user, dto.path, dto.message);
  }

  @Post('restore')
  @RequireProjectRole('editor')
  restore(@CurrentProject() project: Project, @CurrentUser() user: User, @Body() dto: RestoreDto) {
    return this.history.restore(project, user, dto.sha, dto.path);
  }
}
