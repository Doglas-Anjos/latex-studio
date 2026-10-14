// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FasorxFooter } from './fasorx-footer';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it('links to the FasorX hub and its data notice when VITE_FASORX_URL is set', () => {
  vi.stubEnv('VITE_FASORX_URL', 'https://fasorx.com.br');
  render(<FasorxFooter />);
  expect(screen.getByText(`© ${new Date().getFullYear()} FasorX`)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'fasorx.com.br' }).getAttribute('href')).toBe(
    'https://fasorx.com.br',
  );
  expect(screen.getByRole('link', { name: 'Cookies e dados' }).getAttribute('href')).toBe(
    'https://fasorx.com.br/privacidade/',
  );
});

it('shows only the source link on a self-hosted instance', () => {
  vi.stubEnv('VITE_FASORX_URL', '');
  render(<FasorxFooter />);
  expect(screen.queryByText(/FasorX/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Código-fonte' }).getAttribute('href')).toBe(
    'https://github.com/Doglas-Anjos/latex-studio',
  );
});
