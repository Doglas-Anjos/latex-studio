/** A person's LAN editor access as stored (the PIN hash stays in the infrastructure layer). */
export interface LanAccessRow {
  id: string;
  projectId: string;
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
  createAccess(projectId: string, alias: string, pinHash: string): Promise<{ id: string }>;
  /** Every access of a project, with its PIN hash (for verification). */
  accessesOf(projectId: string): Promise<LanAccessRow[]>;
  deleteAccess(id: string): Promise<void>;
  /** Records that an access was just used. */
  touchAccess(id: string): Promise<void>;
}
