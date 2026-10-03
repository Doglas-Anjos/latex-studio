import { open } from 'node:fs/promises';
import type { ExportFormat } from '@latex-studio/core';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { CurrentUser } from '../../auth/presentation/decorators';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import type { User } from '../../users/domain/user';
import { ExportService, type JobStatus, slugify } from '../application/export.service';

const RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

const TYPES: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
};

@Controller('projects/:projectId')
export class ExportController {
  constructor(@Inject(ExportService) private readonly exporter: ExportService) {}

  @RouteConfig(RATE_LIMIT)
  @Get('export/source.zip')
  @RequireProjectRole('viewer')
  @Header('X-Content-Type-Options', 'nosniff')
  async source(@CurrentProject() project: Project): Promise<StreamableFile> {
    return new StreamableFile(await this.exporter.sourceZip(project), {
      type: 'application/zip',
      disposition: `attachment; filename="${slugify(project.name)}.zip"`,
    });
  }

  @RouteConfig(RATE_LIMIT)
  @Post('copy')
  @RequireProjectRole('viewer')
  copy(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Body() body: { name?: unknown } | undefined,
  ): Promise<Project> {
    const name = body?.name;
    if (name !== undefined && typeof name !== 'string') {
      throw new BadRequestException('Invalid name');
    }
    return this.exporter.copy(project, user, name);
  }

  @RouteConfig(RATE_LIMIT)
  @Post('wordcount')
  @RequireProjectRole('viewer')
  @HttpCode(202)
  wordCount(@CurrentProject() project: Project): Promise<{ jobId: string }> {
    return this.exporter.requestWordCount(project);
  }

  @RouteConfig(RATE_LIMIT)
  @Post('export/:format')
  @RequireProjectRole('viewer')
  @HttpCode(202)
  requestExport(
    @CurrentProject() project: Project,
    @Param('format') format: string,
  ): Promise<{ jobId: string }> {
    if (!Object.hasOwn(TYPES, format)) throw new BadRequestException('Unknown format');
    return this.exporter.requestExport(project, format as ExportFormat);
  }

  @Get('jobs/:jobId')
  @RequireProjectRole('viewer')
  jobStatus(@CurrentProject() project: Project, @Param('jobId') jobId: string): Promise<JobStatus> {
    return this.exporter.jobStatus(project, jobId);
  }

  @Get('jobs/:jobId/file')
  @RequireProjectRole('viewer')
  @Header('X-Content-Type-Options', 'nosniff')
  async file(
    @CurrentProject() project: Project,
    @Param('jobId') jobId: string,
  ): Promise<StreamableFile> {
    const { path, format } = await this.exporter.exportFile(project, jobId);
    try {
      return new StreamableFile((await open(path)).createReadStream(), {
        type: TYPES[format],
        disposition: `attachment; filename="${slugify(project.name)}.${format}"`,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('No file');
      throw e;
    }
  }
}
