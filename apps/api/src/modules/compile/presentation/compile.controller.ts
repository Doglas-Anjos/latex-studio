import { open } from 'node:fs/promises';
import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
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
import { type BuildWithEta, CompileService } from '../application/compile.service';
import type { Build } from '../domain/build.repository';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO class in design:paramtypes
import { CompileDto } from './compile.dto';

const COMPILE_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

async function stream(path: string, type: string, disposition?: string): Promise<StreamableFile> {
  try {
    const file = await open(path);
    return new StreamableFile(
      file.createReadStream(),
      disposition ? { type, disposition } : { type },
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('No output');
    throw e;
  }
}

@Controller('projects/:projectId')
export class CompileController {
  constructor(@Inject(CompileService) private readonly compile: CompileService) {}

  @RouteConfig(COMPILE_RATE_LIMIT)
  // editor: compiling spends a worker slot and writes a build; the web already hides it from
  // viewers, who still read the last build (GET builds/pdf/log stay viewer).
  @Post('compile')
  @RequireProjectRole('editor')
  @HttpCode(202)
  request(
    @CurrentProject() project: Project,
    @CurrentUser() user: User,
    @Body() dto: CompileDto,
  ): Promise<Build> {
    return this.compile.request(project, user, dto);
  }

  @Post('builds/:buildId/cancel')
  @RequireProjectRole('editor')
  @HttpCode(200)
  cancel(
    @CurrentProject() project: Project,
    @Param('buildId', ParseUUIDPipe) buildId: string,
  ): Promise<Build> {
    return this.compile.cancel(project, buildId);
  }

  @Get('builds')
  @RequireProjectRole('viewer')
  list(
    @CurrentProject() project: Project,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ): Promise<BuildWithEta[]> {
    return this.compile.list(project, Math.min(Math.max(limit, 1), 20));
  }

  @Get('builds/:buildId')
  @RequireProjectRole('viewer')
  get(
    @CurrentProject() project: Project,
    @Param('buildId', ParseUUIDPipe) buildId: string,
  ): Promise<Build> {
    return this.compile.get(project, buildId);
  }

  @Get('builds/:buildId/pdf')
  @RequireProjectRole('viewer')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', 'sandbox')
  async pdf(
    @CurrentProject() project: Project,
    @Param('buildId', ParseUUIDPipe) buildId: string,
  ): Promise<StreamableFile> {
    const build = await this.compile.get(project, buildId);
    if (build.status !== 'succeeded') throw new NotFoundException('No PDF for this build');
    return stream(this.compile.pdfPath(build), 'application/pdf', 'inline');
  }

  @Get('builds/:buildId/log')
  @RequireProjectRole('viewer')
  @Header('X-Content-Type-Options', 'nosniff')
  async log(
    @CurrentProject() project: Project,
    @Param('buildId', ParseUUIDPipe) buildId: string,
  ): Promise<StreamableFile> {
    const build = await this.compile.get(project, buildId);
    return stream(this.compile.logPath(build), 'text/plain; charset=utf-8');
  }
}
