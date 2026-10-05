// Usage (editor.tsx): extensions: [..., yCollab(ytext, awareness), commentHighlights(ytext, ref)];
//   when the comment list changes: view.dispatch({ effects: refreshHighlights.of(null) }).
import {
  type EditorState,
  type Extension,
  type SelectionRange,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import type * as Y from 'yjs';
import type { CommentScope } from '../comment-scope';
import { lineRangeAt, wordRangeAt } from '../comment-scope';
import type { Comment } from '../services/comment.service';
import { useWorkspaceStore } from '../workspace-store';
import { resolveAnchorPos } from './yjs-anchor';

type Anchored = Pick<Comment, 'id' | 'anchor'>;

export const refreshHighlights = StateEffect.define<null>();

/** Decorations for the given comments, from their Yjs anchors; `ytext` must match `docLength`. */
function resolve(ytext: Y.Text, comments: readonly Anchored[], docLength: number): DecorationSet {
  return Decoration.set(
    comments.flatMap((c) => {
      const from = resolveAnchorPos(ytext, c.anchor.start);
      const to = resolveAnchorPos(ytext, c.anchor.end);
      if (from === null || to === null || from >= to || to > docLength) return [];
      return [
        Decoration.mark({
          class: 'cm-comment',
          attributes: { 'data-comment-id': c.id },
        }).range(from, to),
      ];
    }),
    true,
  );
}

/**
 * Highlights open comments. On a local edit y-codemirror syncs Y.Text from a view plugin, i.e.
 * after the state fields ran, so anchors resolved inside that transaction still point at the old
 * text. The field therefore maps its decorations through the changes and the plugin below asks
 * for a re-resolve once Y.Text caught up (one dispatch per tick, none after destroy).
 */
export function commentHighlights(ytext: Y.Text, comments: { current: Anchored[] }): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => resolve(ytext, comments.current, state.doc.length),
    update(deco, tr) {
      if (tr.docChanged) return deco.map(tr.changes);
      if (!tr.effects.some((e) => e.is(refreshHighlights))) return deco;
      return resolve(ytext, comments.current, tr.state.doc.length);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  const resolveAfterSync = ViewPlugin.fromClass(
    class {
      // Nulled on destroy so a queued refresh never dispatches into a dead view.
      private view: EditorView | null;
      private queued = false;
      private readonly onYChange = () => {
        if (this.queued || comments.current.length === 0) return;
        this.queued = true;
        queueMicrotask(() => {
          this.queued = false;
          // Carries no changes, so it cannot feed back into Y.Text.
          this.view?.dispatch({ effects: refreshHighlights.of(null) });
        });
      };
      constructor(view: EditorView) {
        this.view = view;
        ytext.observe(this.onYChange);
      }
      destroy() {
        this.view = null;
        ytext.unobserve(this.onYChange);
      }
    },
  );
  return [
    field,
    resolveAfterSync,
    EditorView.domEventHandlers({
      click(event) {
        const id = (event.target as HTMLElement)
          .closest?.('[data-comment-id]')
          ?.getAttribute('data-comment-id');
        if (id) useWorkspaceStore.getState().setActiveComment(id);
        return false;
      },
    }),
  ];
}

/** A text range the contextual popup (editor.tsx) is composing a comment over. */
export interface ComposerTarget {
  scope: CommentScope;
  from: number;
  to: number;
}

export interface ComposerRect {
  left: number;
  top: number;
  bottom: number;
}

/** Clears the target (Escape, cancel, submit) or jumps it to a fresh selection/click. */
export const setComposerTarget = StateEffect.define<ComposerTarget | null>();

/** Exact selection; the word under a collapsed cursor; else its line, unless blank. */
function resolveTarget(state: EditorState, sel: SelectionRange): ComposerTarget | null {
  if (sel.from !== sel.to) return { scope: 'selection', from: sel.from, to: sel.to };
  const text = state.doc.toString();
  const word = wordRangeAt(text, sel.head);
  if (word) return { scope: 'word', from: word.from, to: word.to };
  const line = lineRangeAt(text, sel.head, sel.head);
  return line.from < line.to ? { scope: 'line', from: line.from, to: line.to } : null;
}

/** Null when the position is offscreen, or layout isn't ready yet (coordsAtPos may throw). */
function rectFor(view: EditorView, target: ComposerTarget): ComposerRect | null {
  try {
    const pos = Math.min(target.to, view.state.doc.length);
    const coords = view.coordsAtPos(pos, -1) ?? view.coordsAtPos(target.from, 1);
    return coords ? { left: coords.left, top: coords.top, bottom: coords.bottom } : null;
  } catch {
    return null;
  }
}

export interface ComposerCallbacks {
  /** True while the popup's own composer has focus; pointer selection is then ignored. */
  isComposing: () => boolean;
  /** Fires whenever the target changes, and on scroll/doc-change while one is set. */
  onTarget: (target: ComposerTarget | null, rect: ComposerRect | null) => void;
}

/**
 * Lightweight contextual counterpart to the explicit toolbar/gutter/shortcut flow: a mouse click
 * or drag-selection (tagged `select.pointer` by CodeMirror, unlike keyboard selection) proposes a
 * target for editor.tsx's floating popup, highlighted with `cm-comment-draft` so it reads like a
 * draft. Clicking an existing comment mark suppresses the proposal so the sidebar's reveal-thread
 * handler owns that click instead. The target rides out later edits via `tr.changes`, and clears
 * itself if they erase it.
 */
export function commentComposer(callbacks: ComposerCallbacks): Extension {
  let suppressNext = false;
  const field = StateField.define<ComposerTarget | null>({
    create: () => null,
    update(value, tr) {
      const effect = tr.effects.find((e) => e.is(setComposerTarget));
      if (effect) return effect.value;
      if (tr.isUserEvent('select.pointer')) {
        const suppressed = suppressNext;
        suppressNext = false;
        if (callbacks.isComposing()) return value;
        return suppressed ? null : resolveTarget(tr.state, tr.state.selection.main);
      }
      if (value && tr.docChanged) {
        const from = tr.changes.mapPos(value.from, -1);
        const to = tr.changes.mapPos(value.to, 1);
        return from < to ? { ...value, from, to } : null;
      }
      return value;
    },
    provide: (f) =>
      EditorView.decorations.from(f, (value) =>
        value
          ? Decoration.set([
              Decoration.mark({ class: 'cm-comment-draft' }).range(value.from, value.to),
            ])
          : Decoration.none,
      ),
  });
  const scrollPlugin = ViewPlugin.fromClass(
    class {
      private view: EditorView | null;
      private readonly onScroll = () => {
        const target = this.view?.state.field(field) ?? null;
        if (this.view && target) callbacks.onTarget(target, rectFor(this.view, target));
      };
      constructor(view: EditorView) {
        this.view = view;
        view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      }
      destroy() {
        this.view?.scrollDOM.removeEventListener('scroll', this.onScroll);
        this.view = null;
      }
    },
  );
  return [
    field,
    scrollPlugin,
    EditorView.domEventHandlers({
      mousedown(event) {
        suppressNext = !!(event.target as HTMLElement).closest?.('[data-comment-id]');
        return false;
      },
    }),
    EditorView.updateListener.of((u) => {
      const target = u.state.field(field);
      if (target !== u.startState.field(field) || (target && u.docChanged)) {
        callbacks.onTarget(target, target ? rectFor(u.view, target) : null);
      }
    }),
  ];
}
