// In-app spell check. The editor finds the prose words in the viewport (skipping LaTeX commands,
// math and key/path arguments), asks the server which ones are unknown (Hunspell runs there, so any
// dictionary size works), and underlines them. Right-click offers suggestions and "ignore word".
// Results are cached per word so scrolling and typing rarely hit the network.
import { syntaxTree } from '@codemirror/language';
import { type Extension, RangeSetBuilder, StateEffect } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import type { SpellcheckService } from '../services/spellcheck.service';
import { useSettingsStore } from '../settings-store';

// Argument nodes that hold identifiers/paths, not natural language.
const NO_SPELL_ARGS = new Set([
  'BibKeyArgument',
  'LabelArgument',
  'RefArgument',
  'FilePathArgument',
  'BareFilePathArgument',
  'IncludeArgument',
  'IncludeGraphicsArgument',
  'IncludeSvgArgument',
  'InputArgument',
  'BibliographyArgument',
  'BibliographyStyleArgument',
  'UrlArgument',
  'DocumentClassArgument',
  'PackageArgument',
  'ColumnArgument',
  'DefinitionArgument',
  'DefinitionFragmentArgument',
  // Code, not language: skip inline \verb and verbatim/lstlisting environments wholesale.
  'Verbatim',
  'VerbatimEnvironment',
]);
const nonProse = (name: string): boolean =>
  name.endsWith('CtrlSeq') || name.endsWith('Math') || NO_SPELL_ARGS.has(name);

// Words the user chose to ignore, shared across files and sessions (this browser).
const CUSTOM_KEY = 'latex-studio.dict';
function customDict(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}
function addToCustom(word: string) {
  try {
    const s = customDict();
    s.add(word.toLowerCase());
    localStorage.setItem(CUSTOM_KEY, JSON.stringify([...s]));
  } catch {
    // storage unavailable: ignore
  }
}

// Known results, keyed by language + word; shared across editors (dictionaries are global).
const checked = new Map<string, boolean>();
const ckey = (lang: string, word: string) => `${lang}\u0000${word}`;

const WORD = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}+)*/gu;
const SPELL_MARK = Decoration.mark({ class: 'cm-spell-error' });
const spellReady = StateEffect.define<null>();

/** The prose words in the viewport worth checking (skips commands, math, keys, acronyms, ignored). */
function* visibleWords(
  view: EditorView,
  custom: Set<string>,
): Generator<{ word: string; from: number; to: number }> {
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    const skip: [number, number][] = [];
    tree.iterate({
      from,
      to,
      enter(n) {
        if (!nonProse(n.name)) return;
        skip.push([n.from, n.to]);
        return false;
      },
    });
    const text = view.state.sliceDoc(from, to);
    for (const m of text.matchAll(WORD)) {
      const s = from + (m.index ?? 0);
      const e = s + m[0].length;
      const word = m[0];
      if (word.length < 2 || word.length > 100) continue; // the server rejects words over 100 chars
      if (word === word.toUpperCase()) continue; // acronyms (LSTM, RNN…)
      if (custom.has(word.toLowerCase())) continue;
      if (skip.some(([ss, se]) => s < se && e > ss)) continue;
      yield { word, from: s, to: e };
    }
  }
}

/** Underline viewport words already known to be misspelled (from the cache). */
function build(view: EditorView, lang: string, custom: Set<string>): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { word, from, to } of visibleWords(view, custom))
    if (checked.get(ckey(lang, word)) === true) b.add(from, to, SPELL_MARK);
  return b.finish();
}

/** Viewport words we have not yet checked for this language. */
function unknownWords(view: EditorView, lang: string, custom: Set<string>): string[] {
  const out = new Set<string>();
  for (const { word } of visibleWords(view, custom))
    if (!checked.has(ckey(lang, word))) out.add(word);
  return [...out].slice(0, 5000); // the server caps a request at 5000 words
}

/** A small menu of suggestions and "ignore", shown where the user right-clicked a misspelling. */
function openSuggestions(o: {
  view: EditorView;
  word: string;
  from: number;
  to: number;
  x: number;
  y: number;
  projectId: string;
  service: SpellcheckService;
}) {
  const { view, word, from, to, x, y, projectId, service } = o;
  document.querySelector('.spell-popup')?.remove();
  const pop = document.createElement('div');
  pop.className = 'spell-popup';
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', onAway, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onAway = (ev: MouseEvent) => {
    if (!pop.contains(ev.target as Node)) close();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };
  const item = (label: string, run: () => void, cls = '') => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `spell-item ${cls}`.trim();
    btn.textContent = label;
    btn.addEventListener('click', () => {
      run();
      close();
      view.focus();
    });
    pop.append(btn);
  };

  // Keep the menu on-screen — called now and again once the suggestions fill it in.
  const clamp = () => {
    const r = pop.getBoundingClientRect();
    if (r.right > innerWidth) pop.style.left = `${Math.max(4, innerWidth - r.width - 4)}px`;
    if (r.bottom > innerHeight) pop.style.top = `${Math.max(4, y - r.height)}px`;
  };

  document.body.append(pop);
  clamp();
  document.addEventListener('mousedown', onAway, true);
  document.addEventListener('keydown', onKey, true);

  void service
    .suggest(projectId, useSettingsStore.getState().spellcheckLang, word)
    .catch(() => [])
    .then((suggestions) => {
      if (suggestions.length === 0) {
        const none = document.createElement('div');
        none.className = 'spell-none';
        none.textContent = 'Sem sugestões';
        pop.append(none);
      }
      for (const sug of suggestions.slice(0, 6)) {
        item(sug, () => {
          // The doc may have changed (collaborators) since the right-click; only replace if intact.
          if (view.state.sliceDoc(from, to) === word)
            view.dispatch({ changes: { from, to, insert: sug }, userEvent: 'input.complete' });
        });
      }
      const sep = document.createElement('div');
      sep.className = 'spell-sep';
      pop.append(sep);
      item(
        'Ignorar palavra',
        () => {
          addToCustom(word);
          view.dispatch({ effects: spellReady.of(null) });
        },
        'spell-ignore',
      );
      clamp(); // re-measure now that the items are in
    });
}

/** Server-backed spell check gated by the user's setting; underlines prose, right-click for help. */
export function spellcheck(opts: { projectId: string; service: SpellcheckService }): Extension {
  const { projectId, service } = opts;

  const marks = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private custom = customDict();
      private view: EditorView | null;
      private readonly unsub: () => void;
      private timer: ReturnType<typeof setTimeout> | undefined;
      constructor(view: EditorView) {
        this.view = view;
        this.unsub = useSettingsStore.subscribe((s, prev) => {
          if (s.spellcheck !== prev.spellcheck || s.spellcheckLang !== prev.spellcheckLang) {
            this.custom = customDict();
            // Re-render now (clears marks when turned off), then fetch for the new language.
            queueMicrotask(() => this.view?.dispatch({ effects: spellReady.of(null) }));
            this.schedule();
          }
        });
        this.schedule();
      }
      private schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.run(), 500);
      }
      private async run() {
        const view = this.view;
        if (!view) return;
        const s = useSettingsStore.getState();
        if (!s.spellcheck) return;
        const lang = s.spellcheckLang;
        const words = unknownWords(view, lang, this.custom);
        if (words.length) {
          try {
            const bad = new Set(await service.check(projectId, lang, words));
            for (const w of words) checked.set(ckey(lang, w), bad.has(w));
          } catch {
            return; // network error: a later change retries
          }
        }
        this.view?.dispatch({ effects: spellReady.of(null) });
      }
      update(u: ViewUpdate) {
        const s = useSettingsStore.getState();
        const ready = u.transactions.some((t) => t.effects.some((e) => e.is(spellReady)));
        // Re-mark when parsing completes: a command may have been seen as prose before the tree caught up.
        const parsed = syntaxTree(u.state) !== syntaxTree(u.startState);
        if (ready) this.custom = customDict();
        if (u.docChanged || u.viewportChanged || ready || parsed) {
          this.decorations = s.spellcheck
            ? build(u.view, s.spellcheckLang, this.custom)
            : Decoration.none;
        }
        if ((u.docChanged || u.viewportChanged) && s.spellcheck) this.schedule();
      }
      destroy() {
        this.unsub();
        clearTimeout(this.timer);
        this.view = null;
      }
    },
    { decorations: (v) => v.decorations },
  );

  const menu = EditorView.domEventHandlers({
    contextmenu(event, view) {
      const el = (event.target as HTMLElement).closest?.('.cm-spell-error');
      if (!el) return false;
      event.preventDefault();
      const word = el.textContent ?? '';
      const from = view.posAtDOM(el);
      openSuggestions({
        view,
        word,
        from,
        to: from + word.length,
        x: event.clientX,
        y: event.clientY,
        projectId,
        service,
      });
      return true;
    },
  });

  return [marks, menu];
}
