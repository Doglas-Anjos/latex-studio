import type { DocumentSync } from '../domain/document-sync';

/** Records calls as `replace <path>` / `forget <path>`; replaced texts by path. */
export class FakeDocumentSync implements DocumentSync {
  calls: string[] = [];
  texts = new Map<string, string>();
  replaceText = async (_projectId: string, path: string, text: string) => {
    this.calls.push(`replace ${path}`);
    this.texts.set(path, text);
  };
  forget = async (_projectId: string, path: string) => void this.calls.push(`forget ${path}`);
  flush = async (_projectId: string, path: string) => void this.calls.push(`flush ${path}`);
}
