import { snippet } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state';

type Node = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

/** What a command needs from the editor: an EditorView, or a bare state + dispatch in tests. */
export interface Target {
  state: EditorState;
  dispatch: (tr: Transaction) => void;
}

/** Nodes holding math: the delimiters or environment around a `Math` body. */
export const MATH_NODES = new Set([
  'DollarMath',
  'ParenMath',
  'BracketMath',
  'EquationEnvironment',
  'EquationArrayEnvironment',
]);

/** False for an argument the user has not closed yet (`\textbf{abc`), which runs to the end. */
const closed = (arg: Node) => arg.lastChild?.name === 'CloseBrace';

const COMMAND_NODE: Record<string, string> = {
  textbf: 'TextBoldCommand',
  textit: 'TextItalicCommand',
};

/** `\name{…}` around each selection, or unwraps it when the selection already sits inside one. */
export const toggleCommand =
  (name: string) =>
  ({ state, dispatch }: Target): boolean => {
    if (state.readOnly) return false;
    const open = `\\${name}{`;
    const tree = syntaxTree(state);
    const spec = state.changeByRange((r) => {
      for (let n: Node | null = tree.resolveInner(r.from, 1); n; n = n.parent) {
        const arg = n.name === COMMAND_NODE[name] ? n.getChild('TextArgument') : null;
        if (arg && closed(arg) && r.from > arg.from && r.to < arg.to) {
          const cut = arg.from + 1 - n.from;
          return {
            changes: [
              { from: n.from, to: arg.from + 1 },
              { from: arg.to - 1, to: arg.to },
            ],
            range: EditorSelection.range(r.anchor - cut, r.head - cut),
          };
        }
      }
      return {
        changes: [
          { from: r.from, insert: open },
          { from: r.to, insert: '}' },
        ],
        range: EditorSelection.range(r.anchor + open.length, r.head + open.length),
      };
    });
    dispatch(state.update(spec, { userEvent: 'input', scrollIntoView: true }));
    return true;
  };

/** `before`/`after` around each selection; an empty selection leaves the caret between them. */
export const wrap =
  (before: string, after: string) =>
  ({ state, dispatch }: Target): boolean => {
    if (state.readOnly) return false;
    const spec = state.changeByRange((r) => ({
      changes: [
        { from: r.from, insert: before },
        { from: r.to, insert: after },
      ],
      range: EditorSelection.range(r.from + before.length, r.to + before.length),
    }));
    dispatch(state.update(spec, { userEvent: 'input', scrollIntoView: true }));
    return true;
  };

/** Turns the caret's line into `\cmd{line}`, swaps a heading's level, or (null) unwraps it. */
export const setHeading =
  (cmd: string | null) =>
  ({ state, dispatch }: Target): boolean => {
    if (state.readOnly) return false;
    const line = state.doc.lineAt(state.selection.main.head);
    let heading = null as Node | null;
    syntaxTree(state).iterate({
      from: line.from,
      to: line.to,
      enter: (n) => {
        if (n.name === 'SectioningCommand' && n.from >= line.from) heading ??= n.node;
        return !heading;
      },
    });
    const ctrl = heading?.firstChild;
    const arg = heading?.getChild('SectioningArgument');
    if (heading && ctrl && arg) {
      // Only the command or its braces change: a star, [short title] or trailing \label stays.
      const changes = cmd
        ? { from: ctrl.from, to: ctrl.to, insert: `\\${cmd}` }
        : [
            { from: heading.from, to: arg.from + 1 },
            ...(closed(arg) ? [{ from: arg.to - 1, to: arg.to }] : []),
          ];
      dispatch(state.update({ changes, userEvent: 'input' }));
      return true;
    }
    if (!cmd) return true;
    const start = line.from + (/^\s*/.exec(line.text)?.[0].length ?? 0);
    dispatch(
      state.update({
        changes: [
          { from: start, insert: `\\${cmd}{` },
          { from: line.to, insert: '}' },
        ],
        selection: { anchor: line.to + cmd.length + 2 },
        userEvent: 'input',
      }),
    );
    return true;
  };

/** A CodeMirror snippet (`#{}` fields, Tab to the next) replacing the main selection. */
export const insertSnippet =
  (template: string) =>
  ({ state, dispatch }: Target): boolean => {
    if (state.readOnly) return false;
    const { from, to } = state.selection.main;
    snippet(template)({ state, dispatch }, null, from, to);
    return true;
  };

/** The selected lines as `\item`s of `env`, or an empty list with the caret on its first item. */
export const insertList =
  (env: 'itemize' | 'enumerate') =>
  (target: Target): boolean => {
    const { state, dispatch } = target;
    if (state.readOnly) return false;
    const sel = state.selection.main;
    if (sel.empty) return insertSnippet(`\\begin{${env}}\n\t\\item #{}\n\\end{${env}}`)(target);
    const first = state.doc.lineAt(sel.from);
    // A drag that ends at the start of a line does not take that line.
    const last = state.doc.lineAt(state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.to);
    const items = state
      .sliceDoc(first.from, last.to)
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => `  \\item ${l.trim()}`);
    const insert = `\\begin{${env}}\n${items.join('\n')}\n\\end{${env}}`;
    dispatch(
      state.update({
        changes: { from: first.from, to: last.to, insert },
        selection: { anchor: first.from + insert.length },
        userEvent: 'input',
        scrollIntoView: true,
      }),
    );
    return true;
  };

/** `text` on lines of its own: a line break is added where the range has text beside it. */
export function onOwnLines(state: EditorState, from: number, to: number, text: string): string {
  const before = state.sliceDoc(state.doc.lineAt(from).from, from).trim() ? '\n' : '';
  const after = state.sliceDoc(to, state.doc.lineAt(to).to).trim() ? '\n' : '';
  return before + text + after;
}

/** True when `pos` is inside math ($…$, \[…\], equation, align…), where symbols go in bare. */
export function inMath(state: EditorState, pos: number): boolean {
  // Right after `$` or `\[` the caret sits on the delimiter, not yet in the `Math` body.
  for (let n: Node | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent)
    if (n.name === 'Math' || (MATH_NODES.has(n.name) && n.from < pos && pos < n.to)) return true;
  return false;
}

/**
 * A palette symbol or template at the caret: empty `{}` slots become snippet fields (Tab moves
 * between them), and outside math the result is wrapped in `$…$`.
 */
export function insertMath(target: Target, tex: string): boolean {
  // Snippet templates read `\{` as an escaped brace: keep LaTeX's `\{` by doubling the backslash.
  let body = tex.replace(/\\([{}])/g, '\\\\$1').replace(/\{\}/g, '{#{}}');
  // `\alpha` followed by typed letters would become an unknown `\alphax`.
  if (/\\[a-zA-Z]+$/.test(tex)) body += ' ';
  // A snippet without fields leaves the caret before it.
  if (!body.includes('#{}')) body += '#{}';
  const math = inMath(target.state, target.state.selection.main.from);
  return insertSnippet(math ? body : `$${body}$`)(target);
}
