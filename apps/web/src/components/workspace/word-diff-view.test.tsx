// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WordDiffView } from './diff-tab';

describe('WordDiffView', () => {
  afterEach(cleanup);

  it('strikes the removed word, marks the added one and undoes that change only', async () => {
    const onRevert = vi.fn();
    const { container } = render(
      <WordDiffView
        a={'gap addressed by this work.\nARIMA stays.'}
        b={'gap addressed by\nthis study.\nSARIMA stays.'}
        onRevert={onRevert}
      />,
    );
    expect([...container.querySelectorAll('del')].map((d) => d.textContent)).toEqual([
      'work',
      'ARIMA',
    ]);
    expect([...container.querySelectorAll('ins')].map((d) => d.textContent)).toEqual([
      'study',
      'SARIMA',
    ]);
    await userEvent.click(screen.getAllByRole('button', { name: /Desfazer/ })[0] as HTMLElement);
    expect(onRevert).toHaveBeenCalledWith(
      expect.objectContaining({ removed: 'work', added: 'study' }),
    );
  });

  it('offers no undo for read-only comparisons', () => {
    render(<WordDiffView a="old text" b="new text" />);
    expect(screen.queryByRole('button', { name: /Desfazer/ })).toBeNull();
  });
});
