// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings-store';
import { LanguageToggle } from './language-toggle';

describe('LanguageToggle', () => {
  afterEach(() => {
    useSettingsStore.setState({ uiLang: '' });
    cleanup();
  });

  it('sets the UI language from the menu', async () => {
    render(<LanguageToggle />);
    await userEvent.click(screen.getByText('English'));
    expect(useSettingsStore.getState().uiLang).toBe('en');
  });
});
