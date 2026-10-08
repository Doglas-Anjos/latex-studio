import type { KatexOptions } from 'katex';

type Katex = typeof import('katex').default;

// The text comes from collaborators: never trust it (no \href, \includegraphics, \html*), and
// cap sizes and macro expansion so one formula cannot freeze every open editor.
const SAFE: KatexOptions = {
  throwOnError: false,
  trust: false,
  strict: 'ignore',
  maxSize: 20,
  maxExpand: 500,
};

let loading: Promise<Katex> | undefined;

/** KaTeX and its stylesheet, fetched on first use so the editor bundle does not carry them. */
export function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    ([m]) => m.default,
  );
  return loading;
}

/** Renders `tex` into `el`; errors show inline in red instead of throwing. */
export async function renderMath(el: HTMLElement, tex: string, displayMode: boolean) {
  const katex = await loadKatex();
  katex.render(tex, el, { ...SAFE, displayMode });
}

/** HTML for `tex`, for markup we write ourselves (palette buttons), never for user text. */
export async function mathHtml(tex: string, displayMode = false): Promise<string> {
  return (await loadKatex()).renderToString(tex, { ...SAFE, displayMode });
}
