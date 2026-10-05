import {
  APP_CONFIG,
  type AppConfig,
  COMPILE_QUEUE,
  type CompileJobData,
  SafePath,
} from '@latex-studio/core';
import type { BuildOptions } from '@latex-studio/core/schema';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Project } from '../../projects/domain/project';
import type { User } from '../../users/domain/user';
import { BUILD_REPOSITORY, type Build, type BuildRepository } from '../domain/build.repository';

export const MAX_QUEUED_PER_USER = 3;
/**
 * Extra time on top of COMPILE_TIMEOUT_MS before a queued/running build is treated as orphaned
 * (job lost before BullMQ ever ran it, or the worker process died mid-build without updating the
 * row). latexmk itself is killed by COMPILE_TIMEOUT_MS; this only covers what that can't.
 */
export const STALE_BUILD_BUFFER_MS = 2 * 60_000;

export type CompileQueue = Pick<Queue<CompileJobData>, 'add' | 'remove'>;

@Injectable()
export class CompileService {
  private readonly buildsDir: SafePath;
  private readonly staleAfterMs: number;

  constructor(
    @Inject(BUILD_REPOSITORY) private readonly builds: BuildRepository,
    @InjectQueue(COMPILE_QUEUE) private readonly queue: CompileQueue,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.buildsDir = new SafePath(config.BUILDS_DIR);
    this.staleAfterMs = config.COMPILE_TIMEOUT_MS + STALE_BUILD_BUFFER_MS;
  }

  private isStale(build: Build): boolean {
    const since = build.startedAt ?? build.createdAt;
    return Date.now() - new Date(since).getTime() > this.staleAfterMs;
  }

  /**
   * One build at a time per project: while one is queued or running the caller must stop it
   * first (409). A stale one (orphaned job, crashed worker) is failed and replaced instead.
   */
  async request(project: Project, user: User, options: BuildOptions = {}): Promise<Build> {
    const active = await this.builds.findActive(project.id);
    if (active && this.isStale(active)) {
      await this.builds.failStale(active.id, 'Compilação interrompida: o processo não respondeu');
    } else if (active) {
      throw new ConflictException('Já há uma compilação em andamento; pare-a para iniciar outra');
    }
    if ((await this.builds.countQueuedForUser(user.id)) >= MAX_QUEUED_PER_USER) {
      throw new HttpException(
        `At most ${MAX_QUEUED_PER_USER} queued builds per user`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const build = await this.builds.create({
      projectId: project.id,
      requestedBy: user.id,
      engine: project.engine,
      mainFile: project.mainFile,
      options,
    });
    await this.queue.add(
      'compile',
      { buildId: build.id, projectId: project.id },
      { jobId: build.id, removeOnComplete: true, removeOnFail: true },
    );
    return build;
  }

  /** Stops a queued (dropped from the queue) or running (the worker kills latexmk) build. */
  async cancel(project: Project, buildId: string): Promise<Build> {
    const build = await this.get(project, buildId);
    if (!(await this.builds.cancel(build.id))) {
      throw new ConflictException('Esta compilação já terminou');
    }
    // A job that is already active is not removable; the worker notices the row and stops.
    await this.queue.remove(build.id).catch(() => {});
    return this.get(project, buildId);
  }

  async get(project: Project, buildId: string): Promise<Build> {
    const build = await this.builds.findById(project.id, buildId);
    if (!build) throw new NotFoundException('Build not found');
    return build;
  }

  list(project: Project, limit: number): Promise<Build[]> {
    return this.builds.listForProject(project.id, limit);
  }

  pdfPath(build: Build): string {
    return this.buildsDir.resolve(`${build.projectId}/${build.id}/output.pdf`);
  }

  logPath(build: Build): string {
    return this.buildsDir.resolve(`${build.projectId}/${build.id}/output.log`);
  }
}
