import type { Hocuspocus } from '@hocuspocus/server';
import { Inject, Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from '../../projects/domain/project.repository';
import { PROJECT_STORAGE, type ProjectStorage } from '../../projects/domain/project-storage';
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
    private readonly hocuspocus: Pick<Hocuspocus, 'documents' | 'closeConnections' | 'debouncer'>,
    @Inject(YJS_DOC_REPOSITORY) private readonly docs: YjsDocRepository,
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
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

  /**
   * Callers (e.g. `HistoryService.commitFile`) run this inside their own `ProjectLock.run`, so it
   * must not go through `CollabService.store`: that method takes the same per-project lock, and
   * re-entering it here would deadlock forever (the lock is a single promise chain, not a
   * reentrant mutex). Instead this writes the open doc's current state and text directly to the
   * Yjs row and the working tree, snapshotting both synchronously (no await in between) so they
   * never drift apart. `debouncer.isDebounced` going false only means the timer fired, not that
   * the resulting `onStoreDocument` has actually written matching bytes to disk: it may still be
   * queued behind this very lock turn, about to persist a snapshot taken even earlier. So this
   * always writes the doc's current state when it's open, pending timer or not — a caller that
   * asked to flush must never commit text older than what's live. The debounced store (if any) is
   * left pending: it still fires later through the normal path (lock included) and just rewrites
   * the same bytes, so nothing is lost or corrupted, only possibly re-written once more.
   */
  async flush(projectId: string, path: string): Promise<void> {
    const name = `${projectId}/${path}`;
    const doc = this.hocuspocus.documents.get(name);
    if (!doc) return;
    const state = Y.encodeStateAsUpdate(doc);
    const text = doc.getText('content').toString();
    await this.docs.save(projectId, path, state);
    await this.storage.open(projectId).write(path, text);
    await this.projects.markDirty(projectId);
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
