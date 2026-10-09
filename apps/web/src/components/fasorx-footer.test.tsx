// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { FasorxFooter } from './fasorx-footer';

afterEach(cleanup);

it('links to the FasorX hub and its data notice, with the current year', () => {
  render(<FasorxFooter />);
  expect(screen.getByText(`© ${new Date().getFullYear()} FasorX`)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'fasorx.com.br' }).getAttribute('href')).toBe(
    'https://fasorx.com.br',
  );
  expect(screen.getByRole('link', { name: 'Cookies e dados' }).getAttribute('href')).toBe(
    'https://fasorx.com.br/privacidade/',
  );
});
