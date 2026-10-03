export const YJS_DOC_REPOSITORY = Symbol('YJS_DOC_REPOSITORY');

/** Persisted Yjs state per collaborative document, keyed by project and file path. */
export interface YjsDocRepository {
  load(projectId: string, path: string): Promise<Uint8Array | null>;
  /** Insert or replace. */
  save(projectId: string, path: string, state: Uint8Array): Promise<void>;
  deleteForPath(projectId: string, path: string): Promise<void>;
}
