import { describe, expect, it } from 'vitest';
import { autoSize, subjectGraph } from './topics';

describe('autoSize', () => {
  it('scales the map with the document, within bounds', () => {
    expect(autoSize(40)).toEqual({ areas: 3, perArea: 5 });
    expect(autoSize(415)).toEqual({ areas: 7, perArea: 8 });
    expect(autoSize(5000)).toEqual({ areas: 12, perArea: 10 });
  });
});

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

  it('points a click at the main discussion, never the abstract or a passing mention', () => {
    const tex = [
      '\\newacronym{enc}{ENC}{Encoder Attention Transformer}',
      '',
      '\\begin{abstract}',
      'encoder, attention and transformer.',
      '\\end{abstract}',
      '',
      'an encoder, briefly.',
      '',
      source,
    ].join('\n');
    const withAbstract = subjectGraph([{ path: 'main.tex', source: tex }], 'Tese').graph;
    // The attention paragraph (line 7 of `source`) sits at line 15 now.
    expect(withAbstract.nodes.find((n) => n.label === 'encoder')).toMatchObject({ line: 15 });
  });

  it('honours a fixed size over the automatic one', () => {
    const one = subjectGraph(files, 'Tese', { areas: 1, perArea: 1 }).graph;
    expect(one.nodes.filter((n) => n.kind === 'hub')).toHaveLength(1);
    expect(one.links.filter((l) => l.source.startsWith('h:'))).toHaveLength(1);
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
