// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { describe, expect, it } from 'vitest';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { yjsOwnsUndo } from './editor';

/** The editor's undo stack as in editor.tsx: basicSetup's history, yCollab, then the fix. */
function setup(withFix: boolean) {
  const doc = new Y.Doc();
  const ytext = doc.getText('content');
  ytext.insert(0, 'mine');
  const undo = new Y.UndoManager(ytext);
  const view = new EditorView({
    doc: ytext.toString(),
    extensions: [
      basicSetup,
      yCollab(ytext, null, { undoManager: undo }),
      withFix ? yjsOwnsUndo : [],
    ],
    parent: document.body,
  });
  // A collaborator's text arrives from the server (another Y.Doc's update, not a local edit).
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  peer.getText('content').insert(4, ' theirs');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)), 'remote');
  const fire = (e: Event) => {
    view.contentDOM.dispatchEvent(e);
    return e;
  };
  // The Edit/context menu or a phone keyboard; Ctrl+U is basicSetup's "undo selection".
  const browserUndo = () =>
    fire(
      new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }),
    );
  const ctrlU = () =>
    fire(
      new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true, cancelable: true }),
    );
  return { ytext, view, browserUndo, ctrlU };
}

describe("undo never reverts a collaborator's text", () => {
  it('from the browser (and its native undo is stopped) or Ctrl+U', () => {
    const { ytext, view, browserUndo, ctrlU } = setup(true);
    expect(ytext.toString()).toBe('mine theirs');
    expect(browserUndo().defaultPrevented).toBe(true);
    ctrlU();
    ctrlU();
    expect(ytext.toString()).toBe('mine theirs');
    expect(view.state.doc.toString()).toBe('mine theirs');
    view.destroy();
  });

  it("without the fix basicSetup's history undoes it (the bug)", () => {
    const a = setup(false);
    a.browserUndo();
    expect(a.ytext.toString()).toBe('mine');
    a.view.destroy();
    const b = setup(false);
    b.ctrlU();
    b.ctrlU();
    expect(b.ytext.toString()).toBe('mine');
    b.view.destroy();
  });
});
