import { StateEffect, StateField } from '@codemirror/state';
import { type EditorView, GutterMarker, gutter } from '@codemirror/view';
import type { Blame, BlameRun } from '../services/history.service';

export const setBlame = StateEffect.define<Blame | null>();

/** Blame gutter only takes layout space once it's on and data has arrived. */
export function blameVisible(blameOn: boolean, blame: Blame | null | undefined): boolean {
  return blameOn && blame != null;
}

/** "agora", "5 min", "3 h", "2 d", "3 sem", "4 mês", "1 ano": the age of a date, in Portuguese. */
export function ageLabel(date: Date, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  const d = s / 86400;
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (d < 1) return `${Math.floor(s / 3600)} h`;
  if (d < 7) return `${Math.floor(d)} d`;
  if (d < 30.44) return `${Math.floor(d / 7)} sem`;
  if (d < 365.25) return `${Math.floor(d / 30.44)} mês`;
  return `${Math.floor(d / 365.25)} ano`;
}

/** First line of each run -> the run (1-based line numbers); cached per Blame object. */
const startsCache = new WeakMap<Blame, Map<number, BlameRun>>();
export function runStarts(blame: Blame): Map<number, BlameRun> {
  let m = startsCache.get(blame);
  if (!m) {
    m = new Map(blame.lines.map((r) => [r.from, r]));
    startsCache.set(blame, m);
  }
  return m;
}

const blameField = StateField.define<Blame | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setBlame)) return e.value;
    return value;
  },
});

class RunMarker extends GutterMarker {
  constructor(
    private readonly run: BlameRun,
    private readonly blame: Blame,
  ) {
    super();
  }
  override toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-blame-run';
    const c = this.run.sha ? this.blame.commits[this.run.sha] : undefined;
    if (!c) {
      el.textContent = 'não salvo';
      return el;
    }
    const date = new Date(c.date);
    el.textContent = `${c.author.name.split(' ')[0]} · ${ageLabel(date)}`;
    el.title = `${c.author.name} <${c.author.email}>\n${date.toLocaleString('pt-BR')}\n${c.message}`;
    return el;
  }
}
const cont = new (class extends GutterMarker {
  override elementClass = 'cm-blame-cont';
})();

/**
 * Who last changed each line, from GET history/blame. Shown only while a Blame is set.
 * ponytail: assumes the doc matches the working tree the server read; stale after local edits
 * until the next fetch.
 */
export function blameGutter() {
  return [
    blameField,
    gutter({
      class: 'cm-blame-gutter',
      lineMarker(view: EditorView, line) {
        const blame = view.state.field(blameField);
        if (!blame) return null;
        const n = view.state.doc.lineAt(line.from).number;
        const run = runStarts(blame).get(n);
        return run ? new RunMarker(run, blame) : cont;
      },
      lineMarkerChange: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(setBlame))),
    }),
  ];
}
