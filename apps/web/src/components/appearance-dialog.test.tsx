// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceDialog } from './appearance-dialog';

describe('AppearanceDialog', () => {
  afterEach(cleanup);

  it('imports JSON through a real, tabbable button instead of a label-wrapped input', async () => {
    const ref = createRef<HTMLDialogElement>();
    const { container } = render(<AppearanceDialog ref={ref} />);
    const button = screen.getByText('Importar JSON');
    expect(button.tagName).toBe('BUTTON');
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    const click = vi.fn();
    input?.addEventListener('click', click);
    await userEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
