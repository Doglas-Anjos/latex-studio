import type { Hocuspocus } from '@hocuspocus/server';
import { Inject, Injectable } from '@nestjs/common';
import type { DocumentSync } from '../domain/document-sync';
import { YJS_DOC_REPOSITORY, type YjsDocRepository } from '../domain/yjs-doc.repository';
import { HOCUSPOCUS } from './hocuspocus.server';

const isHigh = (s: string, i: number) => /[\uD800-\uDBFF]/.test(s[i] ?? '');
const isLow = (s: string, i: number) => /[\uDC00-\uDFFF]/.test(s[i] ?? '');

/**
 * ponytail: a store already running when a REST write lands can still flush its older text after
 * the caller releases the lock (it waits on the lock, and waiting for it here would deadlock).
 * For `replaceText` the follow-up debounced store rewrites the new text; for `forget` the old path
 * can reappear untracked. Upgrade: a per-document generation checked inside `CollabService.store`.
 */
@Injectable()
export class HocuspocusDocumentSync implements DocumentSync {
  constructor(
    @Inject(HOCUSPOCUS)
    private readonly hocuspocus: Pick<Hocuspocus, 'documents' | 'closeConnections'>,
    @Inject(YJS_DOC_REPOSITORY) private readonly docs: YjsDocRepository,
  ) {}

  /** Minimal prefix/suffix diff, so positions outside the changed span (comment anchors) survive. */
  async replaceText(projectId: string, path: string, text: string): Promise<void> {
    const doc = this.hocuspocus.documents.get(`${projectId}/${path}`);
    // Not open: the next onLoadDocument reads the file from disk.
    if (!doc) return this.docs.deleteForPath(projectId, path);

    const ytext = doc.getText('content');
    const old = ytext.toString();
    if (old === text) return;
    const max = Math.min(old.length, text.length);
    let start = 0;
    while (start < max && old[start] === text[start]) start++;
    if (start > 0 && isHigh(old, start - 1)) start--; // never split a surrogate pair
    let suffix = 0;
    while (
      suffix < max - start &&
      old[old.length - 1 - suffix] === text[text.length - 1 - suffix]
    ) {
      suffix++;
    }
    if (suffix > 0 && isLow(old, old.length - suffix)) suffix--;
    doc.transact(() => {
      ytext.delete(start, old.length - start - suffix);
      ytext.insert(start, text.slice(start, text.length - suffix));
    });
  }

  async forget(projectId: string, path: string): Promise<void> {
    const name = `${projectId}/${path}`;
    const doc = this.hocuspocus.documents.get(name);
    if (doc) {
      this.hocuspocus.closeConnections(name);
      // A pending debounced store sees a stale doc and skips (see onStoreDocument).
      this.hocuspocus.documents.delete(name);
      doc.destroy();
    }
    await this.docs.deleteForPath(projectId, path);
  }
}
