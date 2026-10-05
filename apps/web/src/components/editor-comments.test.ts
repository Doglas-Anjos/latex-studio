// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import {
  type ComposerTarget,
  commentComposer,
  commentHighlights,
  findQuote,
  placePopup,
  refreshHighlights,
  type SelectionAffordance,
  selectionAffordance,
  setComposerTarget,
} from './editor-comments';
import { encodeAnchorPos } from './yjs-anchor';

const TEXT = '\\documentclass{article}\n\\begin{document}\n';
const QUOTE = '\\documentclass';

/** Quoted text of every comment highlight, as the reader sees it. */
function highlights(state: EditorState) {
  const out: string[] = [];
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === 'function') continue;
    for (const it = source.iter(); it.value; it.next())
      out.push(state.doc.sliceString(it.from, it.to));
  }
  return out;
}

/** One editor on a Y.Text, with an open comment over `QUOTE`, like a second tab would see it. */
function setup() {
  const doc = new Y.Doc();
  const ytext = doc.getText('content');
  ytext.insert(0, TEXT);
  const comments = {
    current: [
      {
        id: 'c1',
        anchor: { start: encodeAnchorPos(ytext, 0), end: encodeAnchorPos(ytext, QUOTE.length) },
      },
    ],
  };
  // Snapshot of Y.Text and of the highlights every time the extension asks for a re-resolve.
  const refreshed: { ytext: string; highlights: string[] }[] = [];
  const view = new EditorView({
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        yCollab(ytext, null, { undoManager: false }),
        commentHighlights(ytext, comments),
        EditorView.updateListener.of((u) => {
          if (u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshHighlights))))
            refreshed.push({ ytext: ytext.toString(), highlights: highlights(u.state) });
        }),
      ],
    }),
  });
  return { doc, ytext, view, comments, refreshed };
}

describe('commentHighlights', () => {
  it('highlights the anchored text', () => {
    const { view } = setup();
    expect(highlights(view.state)).toEqual([QUOTE]);
    view.destroy();
  });

  it('keeps the highlight on the quote when the local tab types before it', async () => {
    const { view, ytext, refreshed } = setup();

    view.dispatch({ changes: { from: 0, insert: 'QA ' } });
    // y-codemirror syncs Y.Text from a view plugin, i.e. after the state fields already ran.
    expect(ytext.toString().startsWith('QA ')).toBe(true);
    expect(highlights(view.state)).toEqual([QUOTE]);

    await Promise.resolve();
    // The re-resolve must have seen the updated Y.Text, not the text the field saw.
    expect(refreshed).toEqual([{ ytext: ytext.toString(), highlights: [QUOTE] }]);

    await Promise.resolve();
    expect(refreshed).toHaveLength(1); // no feedback loop: one refresh per Y.Text tick
    view.destroy();
  });

  it('follows a remote insertion too', async () => {
    const { view, ytext, refreshed } = setup();

    ytext.insert(0, 'REMOTE ');
    await Promise.resolve();

    expect(view.state.doc.toString()).toBe(ytext.toString());
    expect(highlights(view.state)).toEqual([QUOTE]);
    expect(refreshed).toHaveLength(1);
    view.destroy();
  });

  it('drops the highlight when the quote is deleted', async () => {
    const { view } = setup();

    view.dispatch({ changes: { from: 0, to: QUOTE.length, insert: '' } });
    await Promise.resolve();

    expect(highlights(view.state)).toEqual([]);
    view.destroy();
  });

  it('coalesces a burst of edits into a single refresh', async () => {
    const { view, refreshed } = setup();

    for (const insert of ['a', 'b', 'c']) view.dispatch({ changes: { from: 0, insert } });
    await Promise.resolve();

    expect(refreshed).toHaveLength(1);
    expect(highlights(view.state)).toEqual([QUOTE]);
    view.destroy();
  });

  it('does not dispatch a queued refresh into a destroyed view', async () => {
    const { view, ytext } = setup();

    view.dispatch({ changes: { from: 0, insert: 'QA ' } });
    const dispatch = vi.spyOn(view, 'dispatch');
    view.destroy();
    await Promise.resolve();

    expect(dispatch).not.toHaveBeenCalled();
    // And the observer is gone, so later Y.Text changes cost nothing.
    ytext.insert(0, 'more');
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

/** Ranges decorated with `cm-comment-draft` by the composer's target field. */
function draftRanges(state: EditorState) {
  const out: { from: number; to: number; cls: unknown }[] = [];
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === 'function') continue;
    for (const it = source.iter(); it.value; it.next())
      out.push({ from: it.from, to: it.to, cls: it.value.spec.class });
  }
  return out;
}

function setupComposer(doc: string) {
  const calls: (ComposerTarget | null)[] = [];
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [commentComposer({ onTarget: (target) => calls.push(target) })],
    }),
  });
  return { view, calls };
}

const target: ComposerTarget = { scope: 'selection', from: 0, to: 5 };

describe('commentComposer', () => {
  it('opens nothing on click or selection', () => {
    const { view, calls } = setupComposer('hello world');
    view.dispatch({ selection: { anchor: 2 }, userEvent: 'select.pointer' });
    view.dispatch({ selection: { anchor: 0, head: 5 }, userEvent: 'select.pointer' });
    expect(calls).toHaveLength(0);
    view.destroy();
  });

  it('opens on the explicit effect and highlights the draft', () => {
    const { view, calls } = setupComposer('hello world');
    view.dispatch({ effects: setComposerTarget.of(target) });
    expect(calls.at(-1)).toEqual(target);
    expect(draftRanges(view.state)).toEqual([{ from: 0, to: 5, cls: 'cm-comment-draft' }]);
    view.destroy();
  });

  it('clears via the explicit effect (escape/cancel)', () => {
    const { view, calls } = setupComposer('hello world');
    view.dispatch({ effects: setComposerTarget.of(target) });
    view.dispatch({ effects: setComposerTarget.of(null) });
    expect(calls.at(-1)).toBeNull();
    view.destroy();
  });

  it('rides out an edit elsewhere in the document', () => {
    const { view, calls } = setupComposer('hello world');
    view.dispatch({ effects: setComposerTarget.of(target) });
    view.dispatch({ changes: { from: 11, insert: '!' } });
    expect(calls.at(-1)).toEqual(target);
    view.destroy();
  });

  it('clears when an edit erases the target range', () => {
    const { view, calls } = setupComposer('hello world');
    view.dispatch({ effects: setComposerTarget.of(target) });
    view.dispatch({ changes: { from: 0, to: 5, insert: '' } });
    expect(calls.at(-1)).toBeNull();
    view.destroy();
  });

  it('re-reports its position on scroll while open', () => {
    const { view, calls } = setupComposer('hello world');
    view.dispatch({ effects: setComposerTarget.of(target) });
    const before = calls.length;
    view.scrollDOM.dispatchEvent(new Event('scroll'));
    expect(calls.length).toBe(before + 1);
    view.destroy();
  });
});

describe('selectionAffordance', () => {
  it('reports a non-empty selection only after it settles, and clears at once', () => {
    vi.useFakeTimers();
    const seen: (SelectionAffordance | null)[] = [];
    const view = new EditorView({
      state: EditorState.create({
        doc: 'hello world',
        extensions: [selectionAffordance((s) => seen.push(s))],
      }),
    });
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    vi.advanceTimersByTime(100);
    view.dispatch({ selection: { anchor: 0, head: 8 } });
    vi.advanceTimersByTime(249);
    expect(seen).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ from: 0, to: 8 });
    view.dispatch({ selection: { anchor: 3 } });
    expect(seen.at(-1)).toBeNull();
    view.destroy();
    vi.useRealTimers();
  });
});

describe('placePopup', () => {
  const box = { width: 600, height: 400 };
  it('goes below the anchor when there is room', () => {
    expect(placePopup({ top: 50, bottom: 70 }, box).top).toBe(76);
  });
  it('flips above when there is no room below', () => {
    expect(placePopup({ top: 300, bottom: 320 }, box).top).toBe(94);
  });
  it('stays inside the box when the anchor is far offscreen', () => {
    expect(placePopup({ top: -900, bottom: -880 }, box).top).toBe(8);
    expect(placePopup({ top: 900, bottom: 920 }, box).top).toBe(192);
    expect(placePopup({ top: 50, bottom: 70 }, { width: 200, height: 400 }).left).toBe(8);
  });
});

describe('findQuote (comment whose Yjs anchor no longer resolves)', () => {
  const text = 'intro\nalpha beta\nmiddle\nalpha beta\nend';
  it('picks the occurrence closest to the stored line', () => {
    expect(findQuote(text, 'alpha beta', 2)).toEqual({ from: 6, to: 16 });
    expect(findQuote(text, 'alpha beta', 4)).toEqual({ from: 24, to: 34 });
  });
  it('gives up on a missing or too short quote', () => {
    expect(findQuote(text, 'gone', 2)).toBeNull();
    expect(findQuote(text, 'al', 2)).toBeNull();
    expect(findQuote(text, undefined, 2)).toBeNull();
  });
});
