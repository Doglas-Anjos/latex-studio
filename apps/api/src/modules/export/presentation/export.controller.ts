import { Controller, Get, Header, Inject, StreamableFile } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { Project } from '../../projects/domain/project';
import {
  CurrentProject,
  RequireProjectRole,
} from '../../projects/presentation/guards/project-role.guard';
import { ExportService, slugify } from '../application/export.service';

@Controller('projects/:projectId/export')
export class ExportController {
  constructor(@Inject(ExportService) private readonly exporter: ExportService) {}

  @RouteConfig({ rateLimit: { max: 10, timeWindow: '1 minute' } })
  @Get('source.zip')
  @RequireProjectRole('viewer')
  @Header('X-Content-Type-Options', 'nosniff')
  async source(@CurrentProject() project: Project): Promise<StreamableFile> {
    return new StreamableFile(await this.exporter.sourceZip(project), {
      type: 'application/zip',
      disposition: `attachment; filename="${slugify(project.name)}.zip"`,
    });
  }
}
