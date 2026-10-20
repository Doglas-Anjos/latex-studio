import type { ProjectRole } from '../../projects/domain/project';

/** What a LAN guest may do while the project is published: any member role but owner. */
export type LanRole = Exclude<ProjectRole, 'owner'>;

/** A person's LAN access as stored (the PIN hash stays in the infrastructure layer). */
export interface LanAccessRow {
  id: string;
  projectId: string;
  /** The real user row backing this access. */
  userId: string;
  alias: string;
  role: LanRole;
  pinHash: string;
  createdAt: Date;
  lastSeen: Date | null;
}

export const LAN_REPOSITORY = Symbol('LAN_REPOSITORY');

export interface LanRepository {
  /** Marks the project as shared on the LAN (idempotent). */
  publish(projectId: string): Promise<void>;
  /** Stops sharing it; the person accesses (and their PINs) are kept for a later re-publish. */
  unpublish(projectId: string): Promise<void>;
  isPublished(projectId: string): Promise<boolean>;
  /** Project ids currently published. */
  listPublished(): Promise<string[]>;
  createAccess(
    projectId: string,
    userId: string,
    alias: string,
    pinHash: string,
    role: LanRole,
  ): Promise<{ id: string }>;
  /** Every access of a project, with its PIN hash (for verification). */
  accessesOf(projectId: string): Promise<LanAccessRow[]>;
  /** The role `userId` holds through an access to `projectId`, or null (the LAN authz check). */
  accessRole(projectId: string, userId: string): Promise<LanRole | null>;
  /** Removes one access, scoped to its project so an id from another project cannot be deleted. */
  deleteAccess(projectId: string, id: string): Promise<void>;
  /** Records that an access was just used. */
  touchAccess(id: string): Promise<void>;
}
