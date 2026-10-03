import { Document, Hocuspocus } from '@hocuspocus/server';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { YjsDocRepository } from '../domain/yjs-doc.repository';
import { HocuspocusDocumentSync } from './hocuspocus-document-sync';

const setup = () => {
  const hocuspocus = new Hocuspocus({});
  const deleted: string[] = [];
  const docs = {
    deleteForPath: async (p: string, path: string) => void deleted.push(`${p}/${path}`),
  } as YjsDocRepository;
  return { hocuspocus, deleted, sync: new HocuspocusDocumentSync(hocuspocus, docs) };
};

describe('HocuspocusDocumentSync', () => {
  it('patches only the changed span of an open doc, keeping later anchors', async () => {
    const { hocuspocus, deleted, sync } = setup();
    const doc = new Document('p/main.tex');
    const ytext = doc.getText('content');
    ytext.insert(0, 'alpha beta gamma');
    hocuspocus.documents.set('p/main.tex', doc);
    // Anchor on the "g" of "gamma".
    const anchor = Y.createRelativePositionFromTypeIndex(ytext, 11);
    const seen: string[] = [];
    ytext.observe((e) => seen.push(JSON.stringify(e.delta)));

    await sync.replaceText('p', 'main.tex', 'alpha BETA-2 gamma');

    expect(ytext.toString()).toBe('alpha BETA-2 gamma');
    expect(seen).toEqual(['[{"retain":6},{"delete":4},{"insert":"BETA-2"}]']);
    expect(Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index).toBe(13);
    expect(deleted).toEqual([]);
  });

  it('drops the saved state of a doc that is not open', async () => {
    const { deleted, sync } = setup();
    await sync.replaceText('p', 'main.tex', 'x');
    expect(deleted).toEqual(['p/main.tex']);
  });

  it('forget unloads the open doc and drops its saved state', async () => {
    const { hocuspocus, deleted, sync } = setup();
    const doc = new Document('p/old.tex');
    hocuspocus.documents.set('p/old.tex', doc);
    await sync.forget('p', 'old.tex');
    expect(hocuspocus.documents.has('p/old.tex')).toBe(false);
    expect(doc.isDestroyed).toBe(true);
    expect(deleted).toEqual(['p/old.tex']);
  });
});
