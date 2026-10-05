import {
  APP_CONFIG,
  type AppConfig,
  COMPILE_QUEUE,
  type CompileJobData,
  SafePath,
} from '@latex-studio/core';
import { InjectQueue } from '@nestjs/bullmq';
import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
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

export type CompileQueue = Pick<Queue<CompileJobData>, 'add'>;

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
   * Reuses the project's queued build if there is one and it still targets the engine being
   * requested (concurrent requests are settled by the repository's unique index); a running build
   * gets one queued behind it. A stale queued or running build (orphaned job, crashed worker) is
   * failed instead of being reused or blocking a fresh one. A queued build with a different engine
   * is never silently reused or retargeted: the caller gets a clear conflict and can retry once it
   * finishes, so the response always matches the engine it was requested with.
   */
  async request(project: Project, user: User): Promise<Build> {
    const active = await this.builds.findActive(project.id);
    if (active && this.isStale(active)) {
      await this.builds.failStale(active.id, 'Compilação interrompida: o processo não respondeu');
    }
    const reusable = active && !this.isStale(active) ? active : null;
    if (reusable?.status === 'queued' && reusable.engine !== project.engine) {
      throw new HttpException(
        'A queued build with a different engine is already in progress; try again once it finishes',
        HttpStatus.CONFLICT,
      );
    }
    let build = reusable?.status === 'queued' ? reusable : null;
    if (!build) {
      if ((await this.builds.countQueuedForUser(user.id)) >= MAX_QUEUED_PER_USER) {
        throw new HttpException(
          `At most ${MAX_QUEUED_PER_USER} queued builds per user`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      build = await this.builds.create({
        projectId: project.id,
        requestedBy: user.id,
        engine: project.engine,
        mainFile: project.mainFile,
      });
    }
    // Also re-sent for a reused build: BullMQ ignores a duplicate jobId, and this recovers a row
    // whose first add failed (Redis down) instead of leaving it queued forever.
    await this.queue.add(
      'compile',
      { buildId: build.id, projectId: project.id },
      { jobId: build.id, removeOnComplete: true, removeOnFail: true },
    );
    return build;
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
