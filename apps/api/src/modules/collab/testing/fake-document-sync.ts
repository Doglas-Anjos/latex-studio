import type { DocumentSync } from '../domain/document-sync';

/** Records calls as `replace <path>` / `forget <path>` / `flushProject` / `revoke <user|all>`. */
export class FakeDocumentSync implements DocumentSync {
  calls: string[] = [];
  texts = new Map<string, string>();
  replaceText = async (_projectId: string, path: string, text: string) => {
    this.calls.push(`replace ${path}`);
    this.texts.set(path, text);
  };
  forget = async (_projectId: string, path: string) => void this.calls.push(`forget ${path}`);
  flush = async (_projectId: string, path: string) => void this.calls.push(`flush ${path}`);
  flushProject = async (_projectId: string) => void this.calls.push('flushProject');
  revoke = (_projectId: string, userId?: string) =>
    void this.calls.push(`revoke ${userId ?? 'all'}`);
}
