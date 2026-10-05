// Usage (editor.tsx): extensions: [..., yCollab(ytext, awareness), commentHighlights(ytext, ref)];
//   when the comment list changes: view.dispatch({ effects: refreshHighlights.of(null) }).
import { type Extension, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import type * as Y from 'yjs';
import type { CommentScope } from '../comment-scope';
import type { Comment } from '../services/comment.service';
import { useWorkspaceStore } from '../workspace-store';
import { resolveAnchorPos } from './yjs-anchor';

type Anchored = Pick<Comment, 'id' | 'anchor'> & Partial<Pick<Comment, 'quote' | 'line'>>;

export const refreshHighlights = StateEffect.define<null>();

/**
 * Where a comment whose Yjs anchor no longer resolves (the document was rebuilt from the file, so
 * its item ids changed) sits now: the occurrence of its quote closest to the line it was made on.
 */
export function findQuote(
  text: string,
  quote: string | undefined,
  line: number | null | undefined,
): { from: number; to: number } | null {
  const q = quote?.trim();
  if (!q || q.length < 3) return null;
  let target = 0;
  for (let n = 1, i = 0; n < (line ?? 1) && i !== -1; n++) {
    i = text.indexOf('\n', i);
    if (i !== -1) target = ++i;
  }
  let best = -1;
  for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + 1)) {
    if (best === -1 || Math.abs(i - target) < Math.abs(best - target)) best = i;
  }
  return best === -1 ? null : { from: best, to: best + q.length };
}

/** Decorations for the given comments, from their Yjs anchors; `ytext` must match `docLength`. */
function resolve(ytext: Y.Text, comments: readonly Anchored[], docLength: number): DecorationSet {
  let text: string | null = null;
  return Decoration.set(
    comments.flatMap((c) => {
      let from = resolveAnchorPos(ytext, c.anchor.start);
      let to = resolveAnchorPos(ytext, c.anchor.end);
      if (from === null || to === null || from >= to) {
        text ??= ytext.toString();
        const found = findQuote(text, c.quote, c.line);
        if (!found) return [];
        ({ from, to } = found);
      }
      if (to > docLength) return [];
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

/** A text range the popup (editor.tsx) is composing a comment over. */
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

/** Sets the target when the user opens the box from the icon; null clears it (Escape, cancel, submit). */
export const setComposerTarget = StateEffect.define<ComposerTarget | null>();

/** Null when the position is offscreen, or layout isn't ready yet (coordsAtPos may throw). */
function rectAt(view: EditorView, from: number): ComposerRect | null {
  try {
    const coords = view.coordsAtPos(Math.min(from, view.state.doc.length), 1);
    return coords ? { left: coords.left, top: coords.top, bottom: coords.bottom } : null;
  } catch {
    return null;
  }
}

export interface ComposerCallbacks {
  /** Fires whenever the target changes, and on scroll/doc-change while one is set. */
  onTarget: (target: ComposerTarget | null, rect: ComposerRect | null) => void;
}

/**
 * Holds the range the comment box is open over, highlighted with `cm-comment-draft`. It never
 * proposes a target by itself (selecting text opens nothing; see `selectionAffordance`). The
 * target rides out later edits via `tr.changes`, clears itself if they erase it, and re-reports
 * its position on scroll so the box can follow.
 */
export function commentComposer(callbacks: ComposerCallbacks): Extension {
  const field = StateField.define<ComposerTarget | null>({
    create: () => null,
    update(value, tr) {
      const effect = tr.effects.find((e) => e.is(setComposerTarget));
      if (effect) return effect.value;
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
        if (this.view && target) callbacks.onTarget(target, rectAt(this.view, target.from));
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
    EditorView.updateListener.of((u) => {
      const target = u.state.field(field);
      if (target !== u.startState.field(field) || (target && u.docChanged)) {
        callbacks.onTarget(target, target ? rectAt(u.view, target.from) : null);
      }
    }),
  ];
}

export interface SelectionAffordance {
  from: number;
  to: number;
  /** First line of the selection; null while it is offscreen. */
  rect: ComposerRect | null;
}

/**
 * Reports a non-empty selection once it settles (`delay` ms without change), and again on
 * scroll so the "add comment" icon follows its first line. An empty selection reports null
 * at once. Nothing opens by itself: editor.tsx only shows an icon.
 */
export function selectionAffordance(
  onChange: (s: SelectionAffordance | null) => void,
  delay = 250,
): Extension {
  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | undefined;
      private view: EditorView | null;
      private readonly report = () => {
        const sel = this.view?.state.selection.main;
        if (!this.view || !sel || sel.empty) return onChange(null);
        onChange({ from: sel.from, to: sel.to, rect: rectAt(this.view, sel.from) });
      };
      private readonly onScroll = () => {
        if (this.view && !this.view.state.selection.main.empty) this.report();
      };
      constructor(view: EditorView) {
        this.view = view;
        view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      }
      update(u: ViewUpdate) {
        if (!u.selectionSet && !u.docChanged) return;
        clearTimeout(this.timer);
        if (u.state.selection.main.empty) onChange(null);
        else this.timer = setTimeout(this.report, delay);
      }
      destroy() {
        clearTimeout(this.timer);
        this.view?.scrollDOM.removeEventListener('scroll', this.onScroll);
        this.view = null;
      }
    },
  );
}

/**
 * Box position (relative to the editor box) under the icon anchored at `anchor`: right-aligned,
 * flipped above when there is no room below, always clamped inside `box`.
 */
export function placePopup(
  anchor: { top: number; bottom: number },
  box: { width: number; height: number },
  size = { w: 320, h: 200 },
  margin = 8,
): { left: number; top: number } {
  const w = Math.min(size.w, box.width - 2 * margin);
  const below = anchor.bottom + 6;
  const top = below + size.h + margin > box.height ? anchor.top - 6 - size.h : below;
  return {
    left: Math.max(margin, box.width - w - 40),
    top: Math.max(margin, Math.min(top, box.height - size.h - margin)),
  };
}
