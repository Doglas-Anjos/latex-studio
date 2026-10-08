import {
  APP_CONFIG,
  and,
  DATABASE,
  type Database,
  eq,
  isNotNull,
  type LockRedis,
  lte,
  MAINTENANCE_QUEUE,
  SafePath,
  type WorkerConfig,
  withProjectLock,
} from '@latex-studio/core';
import { fileEdits, projects, users } from '@latex-studio/core/schema';
import { AUTOSAVE_AUTHOR, AUTOSAVE_MESSAGE, GitRepository } from '@latex-studio/git-store';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

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
    // The queue's own connection: BullMQ's typed proxy hides `eval`, but forwards it to ioredis.
    const redis = (await this.queue.getBackend().client) as unknown as LockRedis;
    for (const { id } of dirty) {
      const startedAt = new Date();
      try {
        // The same Redis lock the api's ProjectLock takes, so commits never interleave on a repo.
        await withProjectLock(redis, id, async () => {
          const repo = GitRepository.open(this.repos.resolve(id));
          // One autosave per editor, so blame names the person; a file touched by several goes to
          // its latest editor with the others as co-authors. Anything left is the generic autosave.
          const edits = await this.db
            .select({
              path: fileEdits.path,
              name: users.name,
              email: users.email,
              at: fileEdits.updatedAt,
            })
            .from(fileEdits)
            .innerJoin(users, eq(users.id, fileEdits.userId))
            .where(and(eq(fileEdits.projectId, id), lte(fileEdits.updatedAt, startedAt)))
            .orderBy(fileEdits.updatedAt);
          const byPath = new Map<string, Array<{ name: string; email: string }>>();
          for (const e of edits) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);
          type Author = { name: string; email: string };
          type Group = { author: Author; paths: string[]; co: Map<string, Author> };
          const byEditor = new Map<string, Group>();
          for (const [path, editors] of byPath) {
            const last = editors.at(-1) as Author;
            const group: Group = byEditor.get(last.email) ?? {
              author: last,
              paths: [],
              co: new Map(),
            };
            group.paths.push(path);
            for (const e of editors) if (e.email !== last.email) group.co.set(e.email, e);
            byEditor.set(last.email, group);
          }
          for (const { author, paths, co } of byEditor.values()) {
            await repo.commitPaths(paths, AUTOSAVE_MESSAGE, author, [...co.values()]);
          }
          await repo.commitAll(AUTOSAVE_MESSAGE, AUTOSAVE_AUTHOR);
          await this.db
            .delete(fileEdits)
            .where(and(eq(fileEdits.projectId, id), lte(fileEdits.updatedAt, startedAt)));
          // A project marked dirty again while committing stays dirty for the next run.
          await this.db
            .update(projects)
            .set({ dirtySince: null })
            .where(and(eq(projects.id, id), lte(projects.dirtySince, startedAt)));
        });
      } catch (e) {
        this.logger.error(`Autocommit of ${id} failed: ${(e as Error).message}`);
      }
    }
  }
}
