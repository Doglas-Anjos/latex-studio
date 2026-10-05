import type { builds } from '@latex-studio/core/schema';
import type { ProjectEngine } from '../../projects/domain/project';

export type Build = typeof builds.$inferSelect;

export const BUILD_REPOSITORY = Symbol('BUILD_REPOSITORY');

export interface NewBuild {
  projectId: string;
  requestedBy: string;
  engine: ProjectEngine;
  mainFile: string;
}

export interface BuildRepository {
  /** Inserts a queued build, or returns the project's existing queued build. */
  create(build: NewBuild): Promise<Build>;
  findById(projectId: string, buildId: string): Promise<Build | null>;
  /** Newest first. */
  listForProject(projectId: string, limit: number): Promise<Build[]>;
  /** Most recent queued or running build of the project. */
  findActive(projectId: string): Promise<Build | null>;
  countQueuedForUser(userId: string): Promise<number>;
  /**
   * Marks a queued/running build as failed (orphaned job or crashed worker). Returns false if it
   * already reached a terminal status, so a late result from the original worker is not reopened.
   */
  failStale(buildId: string, message: string): Promise<boolean>;
}
