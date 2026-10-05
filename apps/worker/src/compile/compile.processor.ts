import { createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  APP_CONFIG,
  and,
  COMPILE_QUEUE,
  type CompileJobData,
  DATABASE,
  type Database,
  desc,
  eq,
  inArray,
  SafePath,
  type WorkerConfig,
} from '@latex-studio/core';
import { builds } from '@latex-studio/core/schema';
import { GitRepository } from '@latex-studio/git-store';
import { parseLatexLog } from '@latex-studio/latex-tools';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import { snapshotProject } from '../snapshot';
import { LatexmkRunner } from './latexmk-runner';
import { toBuildStatus } from './log-to-build';

const KEEP_BUILDS = 3;
// A runaway document can write gigabytes: big PDFs/synctex are dropped, the log is truncated.
const MAX_OUTPUT = 64 * 1024 * 1024;
const MAX_LOG = 8 * 1024 * 1024;
const OUTPUTS = [
  ['.pdf', 'output.pdf'],
  ['.synctex.gz', 'output.synctex.gz'],
] as const;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

@Processor(COMPILE_QUEUE)
export class CompileProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(CompileProcessor.name);
  private readonly repos: SafePath;
  private readonly buildsDir: SafePath;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LatexmkRunner) private readonly runner: LatexmkRunner,
    @Inject(APP_CONFIG) private readonly config: WorkerConfig,
  ) {
    super();
    this.repos = new SafePath(config.REPOS_DIR);
    this.buildsDir = new SafePath(config.BUILDS_DIR);
  }

  // @Processor options are fixed at class definition, before the config is loaded.
  onApplicationBootstrap() {
    this.worker.concurrency = this.config.COMPILE_CONCURRENCY;
  }

  async process(job: Job<CompileJobData>): Promise<void> {
    const { buildId, projectId } = job.data;
    // `running` too: a job retried after a worker crash starts over.
    const [build] = await this.db
      .update(builds)
      .set({ status: 'running', startedAt: new Date() })
      .where(
        and(
          eq(builds.id, buildId),
          eq(builds.projectId, projectId),
          inArray(builds.status, ['queued', 'running']),
        ),
      )
      .returning();
    if (!build) return;

    let tmp: string | undefined;
    try {
      const repoDir = this.repos.resolve(projectId);
      const outDir = this.buildsDir.resolve(`${projectId}/${buildId}`);
      tmp = await snapshotProject(this.config.REPOS_DIR, projectId);
      const commitSha =
        (
          await GitRepository.open(repoDir)
            .log(1)
            .catch(() => [])
        )[0]?.sha ?? null;
      new SafePath(tmp).resolve(build.mainFile); // throws on `..`, absolute or odd names

      const run = await this.runner.run({
        workDir: tmp,
        engine: build.engine,
        mainFile: build.mainFile,
      });

      await mkdir(outDir, { recursive: true });
      const stem = basename(build.mainFile, extname(build.mainFile));
      let tooLarge = false;
      for (const [ext, name] of OUTPUTS) {
        const from = join(tmp, 'out', stem + ext);
        if (!(await exists(from))) continue;
        if ((await stat(from)).size > MAX_OUTPUT) tooLarge = true;
        else await copyFile(from, join(outDir, name));
      }
      const logFrom = join(tmp, 'out', `${stem}.log`);
      const logPath = join(outDir, 'output.log');
      if (await exists(logFrom)) {
        await pipeline(createReadStream(logFrom, { end: MAX_LOG - 1 }), createWriteStream(logPath));
      }
      const log = (await exists(logPath)) ? await readFile(logPath, 'utf8') : '';
      const { errors, warnings } = parseLatexLog(log);
      const status = toBuildStatus({
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        pdfExists: await exists(join(outDir, 'output.pdf')),
      });
      await this.finish(buildId, {
        status: tooLarge && status === 'succeeded' ? 'failed' : status,
        exitCode: run.exitCode,
        commitSha,
        errors: tooLarge ? [{ message: 'Output too large' }, ...errors] : errors,
        warnings,
      });
    } catch (e) {
      this.logger.error(`Build ${buildId} crashed: ${(e as Error).message}`);
      await this.finish(buildId, {
        status: 'failed',
        errors: [{ message: 'The compiler could not be run' }],
      });
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true });
      await this.prune(projectId);
    }
  }

  /** Skips rows the API already failed as stale, so a late result can't reopen them. */
  private async finish(buildId: string, values: Partial<typeof builds.$inferInsert>) {
    await this.db
      .update(builds)
      .set({ ...values, finishedAt: new Date() })
      .where(and(eq(builds.id, buildId), inArray(builds.status, ['queued', 'running'])));
  }

  /** Keeps the newest KEEP_BUILDS finished builds of the project, on disk and in the table. */
  private async prune(projectId: string) {
    const old = await this.db
      .select({ id: builds.id })
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          inArray(builds.status, ['succeeded', 'failed', 'timeout']),
        ),
      )
      .orderBy(desc(builds.createdAt))
      .offset(KEEP_BUILDS);
    if (old.length === 0) return;
    for (const { id } of old) {
      await rm(this.buildsDir.resolve(`${projectId}/${id}`), { recursive: true, force: true });
    }
    await this.db.delete(builds).where(
      inArray(
        builds.id,
        old.map((b) => b.id),
      ),
    );
  }
}
