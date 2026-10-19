import { StateEffect, StateField } from '@codemirror/state';
import { type EditorView, GutterMarker, gutter } from '@codemirror/view';
import type { Blame, BlameRun } from '../services/history.service';
import { authorAt, type LineAuthor, lineAuthorsField } from './editor-authors';
import { peerSlot } from './presence';

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
  // Runs are cached per Blame object, so identity means same text: no DOM rebuild on each update.
  override eq(other: GutterMarker) {
    return other instanceof RunMarker && other.run === this.run;
  }
  override toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-blame-run';
    const c = this.run.sha ? this.blame.commits[this.run.sha] : undefined;
    if (!c) {
      el.textContent = 'não salvo';
      el.classList.add('cm-blame-unsaved');
      return el;
    }
    const date = new Date(c.date);
    el.textContent = `${c.author.name.split(' ')[0]} · ${ageLabel(date)}`;
    el.title = `${c.author.name}\n${date.toLocaleString('pt-BR')}\n${c.message}`;
    // Side mark in the author's stable palette slot, so each person's lines read apart at a glance.
    // Keyed by name (the blame API drops e-mails/ids), so it does not match the cursor colour, which
    // is keyed by user id; a CSS var (not a resolved hex) keeps the slot right after a theme switch.
    el.style.setProperty('--blame-color', `var(--peer-${peerSlot(c.author.name) + 1})`);
    return el;
  }
}
const cont = new (class extends GutterMarker {
  override elementClass = 'cm-blame-cont';
})();

/**
 * Who is editing a line right now, before any commit: the live author's first name + colour at the
 * start of each run, a coloured bar on its other lines. Overrides the committed blame for that line,
 * so an unsaved change shows who made it instead of a blank "não salvo".
 */
class LiveMarker extends GutterMarker {
  constructor(
    private readonly author: LineAuthor,
    private readonly head: boolean,
  ) {
    super();
  }
  override eq(other: GutterMarker) {
    return (
      other instanceof LiveMarker && other.author.id === this.author.id && other.head === this.head
    );
  }
  override toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-blame-run cm-blame-live';
    if (this.author.color) el.style.setProperty('--blame-color', this.author.color);
    if (this.head) {
      el.textContent = `${this.author.name.split(' ')[0] || '—'} · agora`;
      el.title = `${this.author.name} — edição não salva`;
    }
    return el;
  }
}

/**
 * Who last changed each line, from GET history/blame. Shown only while a Blame is set.
 * ponytail: assumes the doc matches the working tree the server read; stale after local edits
 * until the next fetch.
 */
export function blameGutter() {
  return [
    blameField,
    lineAuthorsField,
    gutter({
      class: 'cm-blame-gutter',
      lineMarker(view: EditorView, line) {
        const n = view.state.doc.lineAt(line.from).number;
        // A live (uncommitted) author wins: show who is editing this line now.
        const authors = view.state.field(lineAuthorsField, false);
        const live = authors ? authorAt(authors, line.from) : null;
        if (live) {
          const prev = n > 1 && authors ? authorAt(authors, view.state.doc.line(n - 1).from) : null;
          return new LiveMarker(live, !prev || prev.id !== live.id);
        }
        const blame = view.state.field(blameField);
        if (!blame) return null;
        const run = runStarts(blame).get(n);
        return run ? new RunMarker(run, blame) : cont;
      },
      // Re-render on a new blame or whenever live authorship changed.
      lineMarkerChange: (u) =>
        u.startState.field(lineAuthorsField, false) !== u.state.field(lineAuthorsField, false) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(setBlame))),
    }),
  ];
}
