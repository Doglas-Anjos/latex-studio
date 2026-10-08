// Browser-native spellcheck on the editor, made LaTeX-aware: the content gets spellcheck="true"
// (and a `lang`, so the browser picks that dictionary), while commands, math and key/path arguments
// are marked spellcheck="false", so only the prose is checked. Suggestions and "add to dictionary"
// come from the browser's own right-click menu — no dictionary is bundled.
import { syntaxTree } from '@codemirror/language';
import { Compartment, type Extension, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
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
]);

/** Control sequences (\cmd), math, and identifier/path arguments: never natural language. */
const nonProse = (name: string): boolean =>
  name.endsWith('CtrlSeq') || name.endsWith('Math') || NO_SPELL_ARGS.has(name);

const NOSPELL = Decoration.mark({ attributes: { spellcheck: 'false' } });

/** spellcheck="false" over the visible non-prose spans (native spellcheck only reads the viewport). */
function buildMarks(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (!nonProse(node.name)) return;
        const s = Math.max(node.from, from);
        const e = Math.min(node.to, to);
        if (e > s) b.add(s, e, NOSPELL);
        return false; // the whole span is excluded; don't descend
      },
    });
  }
  return b.finish();
}

function contentAttrs() {
  const s = useSettingsStore.getState();
  return EditorView.contentAttributes.of(
    s.spellcheck ? { spellcheck: 'true', lang: s.spellcheckLang } : { spellcheck: 'false' },
  );
}

/** Native spellcheck gated by the user's setting, excluding LaTeX commands/math/keys from checking. */
export function spellcheck(): Extension {
  const attrs = new Compartment();

  const marks = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildMarks(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = buildMarks(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );

  const reactive = ViewPlugin.fromClass(
    class {
      private view: EditorView | null;
      private readonly unsub: () => void;
      constructor(view: EditorView) {
        this.view = view;
        this.unsub = useSettingsStore.subscribe((s, prev) => {
          if (s.spellcheck !== prev.spellcheck || s.spellcheckLang !== prev.spellcheckLang) {
            this.view?.dispatch({ effects: attrs.reconfigure(contentAttrs()) });
          }
        });
      }
      destroy() {
        this.unsub();
        this.view = null;
      }
    },
  );

  return [attrs.of(contentAttrs()), marks, reactive];
}
