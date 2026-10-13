import { describe, expect, it } from 'vitest';
import { extractTopics } from './topics';

describe('extractTopics', () => {
  it('ranks repeated terms, drops stopwords/math, and links co-occurring topics', () => {
    const tex = [
      'The wind speed forecast uses a neural network. % neural network comment',
      '',
      'A wind speed model improves the forecast with a neural network $\\alpha=1$.',
      '',
      'The wind speed series feeds the neural network.',
    ].join('\n');
    const { nodes, edges } = extractTopics(tex, 10);
    const terms = nodes.map((n) => n.term);

    // "wind speed" appears in all three paragraphs; the bigram is captured and ranks.
    expect(terms).toContain('wind speed');
    // Stopwords and math tokens never become nodes.
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('alpha');
    // Topics sharing a paragraph are linked (undirected, a<b).
    const linked = (a: string, b: string) =>
      edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
    expect(linked('wind speed', 'neural network')).toBe(true);
  });
});
