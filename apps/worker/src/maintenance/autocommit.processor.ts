import {
  APP_CONFIG,
  and,
  DATABASE,
  type Database,
  eq,
  isNotNull,
  lte,
  MAINTENANCE_QUEUE,
  SafePath,
  type WorkerConfig,
} from '@latex-studio/core';
import { projects } from '@latex-studio/core/schema';
import { GitRepository } from '@latex-studio/git-store';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

const AUTHOR = { name: 'LaTeX Studio', email: 'autosave@latex-studio.local' };
const EVERY_MS = 5 * 60 * 1000;

/** Every 5 minutes, commits the working tree of projects marked dirty by collaborative edits. */
@Processor(MAINTENANCE_QUEUE)
export class AutocommitProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AutocommitProcessor.name);
  private readonly repos: SafePath;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    @Inject(APP_CONFIG) config: WorkerConfig,
  ) {
    super();
    this.repos = new SafePath(config.REPOS_DIR);
  }

  // Upsert by id: restarts and several workers keep a single schedule.
  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'autocommit',
      { every: EVERY_MS },
      { name: 'autocommit', data: {}, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }

  async process(): Promise<void> {
    const dirty = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(isNotNull(projects.dirtySince));
    for (const { id } of dirty) {
      const startedAt = new Date();
      try {
        // ponytail: no lock shared with the api's in-process ProjectLock, so a commit here can
        // interleave with an api commit on the same repo. Upgrade path: a Redis lock per project.
        await GitRepository.open(this.repos.resolve(id)).commitAll('Autosave', AUTHOR);
        // A project marked dirty again while committing stays dirty for the next run.
        await this.db
          .update(projects)
          .set({ dirtySince: null })
          .where(and(eq(projects.id, id), lte(projects.dirtySince, startedAt)));
      } catch (e) {
        this.logger.error(`Autocommit of ${id} failed: ${(e as Error).message}`);
      }
    }
  }
}
