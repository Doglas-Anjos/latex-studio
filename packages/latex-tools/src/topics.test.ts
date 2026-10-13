import { describe, expect, it } from 'vitest';
import { subjectGraph } from './topics';

describe('subjectGraph', () => {
  // Two areas that never share a paragraph, plus "model", which is in every paragraph.
  const source = [
    'rmse and mape measure the error of the model.',
    'the model error uses rmse, and mape too.',
    'rmse with mape reveal the model error.',
    'attention inside the encoder of the transformer model.',
    'transformer attention runs the encoder model.',
    'the transformer gives attention to the encoder model.',
    'models \\cite{hyndman2018forecasting} again.',
  ].join('\n\n');
  const files = [{ path: 'main.tex', source }];
  const first = subjectGraph(files, 'Tese');
  const g = first.graph;
  /** The hub a term belongs to (the term itself when it is the hub). */
  const area = (t: string) =>
    g.nodes.some((n) => n.id === `h:${t}`)
      ? `h:${t}`
      : g.links.find((l) => l.target === `t:${t}`)?.source;

  it('groups terms that share paragraphs into separate areas', () => {
    expect(area('rmse')).toBeDefined();
    expect(area('rmse')).toBe(area('mape'));
    expect(area('attention')).toBe(area('encoder'));
    expect(area('rmse')).not.toBe(area('attention'));
    expect(g.links.some((l) => l.source === 'root' && l.target === area('rmse'))).toBe(true);
  });

  it('puts the document-wide term on the root and drops keys and plurals', () => {
    expect(area('model')).toBe('root');
    const labels = g.nodes.map((n) => n.label);
    expect(labels).not.toContain('models');
    expect(labels).not.toContain('hyndman');
  });

  it('points a click at the first paragraph using the term', () => {
    expect(g.nodes.find((n) => n.label === 'encoder')).toMatchObject({ path: 'main.tex', line: 7 });
  });

  it('evolves from the previous areas: an area keeps the name it had', () => {
    expect(first.areas.get('rmse')).toBe(first.areas.get('mape'));
    // Say the error area was named "mape" last time; a seeded run keeps that name.
    const errorArea = first.areas.get('rmse');
    const previous = new Map(
      [...first.areas].map(([t, hub]) => [t, hub === errorArea ? 'mape' : hub]),
    );
    const next = subjectGraph(files, 'Tese', { previous });
    expect(next.graph.nodes.some((n) => n.id === 'h:mape')).toBe(true);
    expect(next.areas.get('rmse')).toBe('mape');
  });
});
