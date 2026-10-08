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
import { DOCUMENT_SYNC, type DocumentSync } from '../../collab/domain/document-sync';
import { ProjectLock } from '../../projects/application/project-lock';
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
/** Assumed compile time for a project with no finished build yet, used in the queue estimate. */
export const DEFAULT_COMPILE_MS = 30_000;

export type CompileQueue = Pick<Queue<CompileJobData>, 'add' | 'remove'>;
/** A build plus, for a queued/running one, the estimated wait before it starts (ms). */
export type BuildWithEta = Build & { etaMs?: number };

@Injectable()
export class CompileService {
  private readonly buildsDir: SafePath;
  private readonly staleAfterMs: number;
  private readonly concurrency: number;

  constructor(
    @Inject(BUILD_REPOSITORY) private readonly builds: BuildRepository,
    @InjectQueue(COMPILE_QUEUE) private readonly queue: CompileQueue,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(ProjectLock) private readonly lock: ProjectLock,
    @Inject(DOCUMENT_SYNC) private readonly sync: DocumentSync,
  ) {
    this.buildsDir = new SafePath(config.BUILDS_DIR);
    this.staleAfterMs = config.COMPILE_TIMEOUT_MS + STALE_BUILD_BUFFER_MS;
    this.concurrency = Math.max(1, config.COMPILE_CONCURRENCY ?? 1);
  }

  private isStale(build: Build): boolean {
    const since = build.startedAt ?? build.createdAt;
    return Date.now() - new Date(since).getTime() > this.staleAfterMs;
  }

  /**
   * One build at a time per project: while one is queued or running the caller must stop it
   * first (409). A stale one (orphaned job, crashed worker) is failed and replaced instead.
   * Open docs are flushed first under the project lock, so the build sees the last seconds of
   * typing that the 2-10s store debounce has not written yet.
   */
  request(project: Project, user: User, options: BuildOptions = {}): Promise<Build> {
    return this.lock.run(project.id, async () => {
      await this.sync.flushProject(project.id);
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
    });
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

  async list(project: Project, limit: number): Promise<BuildWithEta[]> {
    const rows: BuildWithEta[] = await this.builds.listForProject(project.id, limit);
    const head = rows[0];
    if (head && (head.status === 'queued' || head.status === 'running')) {
      rows[0] = { ...head, etaMs: await this.estimateEta(head) };
    }
    return rows;
  }

  /**
   * Rough wait before `build` starts (or, if running, finishes): the summed expected duration of
   * every build ahead of it in the global queue, counting a running build's remaining time, divided
   * by the worker concurrency. Each project's expected duration is the mean of its recent succeeded
   * builds; projects with no history use DEFAULT_COMPILE_MS.
   * ponytail: mean of a tiny history and a flat concurrency divide; good while compile times are
   * stable and the queue short. Refine (percentiles, bin-packing) only if estimates feel off.
   */
  private async estimateEta(build: Build): Promise<number> {
    const active = await this.builds.listActive();
    const durations = new Map<string, number>();
    const durationFor = async (projectId: string): Promise<number> => {
      const cached = durations.get(projectId);
      if (cached !== undefined) return cached;
      const recent = await this.builds.recentFinished(projectId, 3);
      const samples = recent
        .map((b) => (b.finishedAt && b.startedAt ? +b.finishedAt - +b.startedAt : 0))
        .filter((ms) => ms > 0);
      const dur = samples.length
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : DEFAULT_COMPILE_MS;
      durations.set(projectId, dur);
      return dur;
    };

    const now = Date.now();
    let totalMs = 0;
    for (const b of active) {
      if (+b.createdAt > +build.createdAt) break; // active is oldest-first; the rest are behind us
      const dur = await durationFor(b.projectId);
      if (b.status === 'running') {
        totalMs += b.startedAt ? Math.max(0, dur - (now - +b.startedAt)) : dur;
      } else if (b.id !== build.id) {
        totalMs += dur; // a build queued ahead of this one
      }
    }
    return Math.round(totalMs / this.concurrency);
  }

  pdfPath(build: Build): string {
    return this.buildsDir.resolve(`${build.projectId}/${build.id}/output.pdf`);
  }

  logPath(build: Build): string {
    return this.buildsDir.resolve(`${build.projectId}/${build.id}/output.log`);
  }
}
