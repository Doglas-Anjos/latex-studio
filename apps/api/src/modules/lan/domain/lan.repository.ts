/** A person's LAN editor access as stored (the PIN hash stays in the infrastructure layer). */
export interface LanAccessRow {
  id: string;
  projectId: string;
  /** The real user row backing this access. */
  userId: string;
  alias: string;
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
  ): Promise<{ id: string }>;
  /** Every access of a project, with its PIN hash (for verification). */
  accessesOf(projectId: string): Promise<LanAccessRow[]>;
  /** Whether `userId` has an access to `projectId` (the LAN authz check). */
  hasAccess(projectId: string, userId: string): Promise<boolean>;
  /** Removes one access, scoped to its project so an id from another project cannot be deleted. */
  deleteAccess(projectId: string, id: string): Promise<void>;
  /** Records that an access was just used. */
  touchAccess(id: string): Promise<void>;
}
