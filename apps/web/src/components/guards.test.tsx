// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { ApiError } from '../services/api-client';
import { type AuthService, AuthServiceToken } from '../services/auth.service';
import { type FasorxIdentity, IdentityToken } from '../services/identity';
import { renderWithApp } from '../test/render';
import { RequireAuth } from './guards';

afterEach(cleanup);

it('shows what the API client said on 401 and leaves the redirect to it', async () => {
  const identity = {
    enabled: true,
    watch: () => () => {},
    goToLogin: vi.fn(),
    goToLoginGuarded: vi.fn(() => false),
  } as unknown as FasorxIdentity;
  const auth = {
    me: vi.fn().mockRejectedValue(new ApiError(401, 'Sessão não confirmada')),
  } as unknown as AuthService;
  renderWithApp(
    <RequireAuth />,
    new Container().register(IdentityToken, identity).register(AuthServiceToken, auth),
  );
  expect(await screen.findByText('Sessão não confirmada')).toBeTruthy();
  expect(identity.goToLoginGuarded).not.toHaveBeenCalled();
  expect(identity.goToLogin).not.toHaveBeenCalled();
});

it('goes straight to login, with no breaker, when FasorX says the session ended', async () => {
  let signedOut = () => {};
  const identity = {
    enabled: true,
    watch: (cb: () => void) => {
      signedOut = cb;
      return () => {};
    },
    goToLogin: vi.fn(),
    goToLoginGuarded: vi.fn(() => true),
  } as unknown as FasorxIdentity;
  const auth = { me: vi.fn(() => new Promise(() => {})) } as unknown as AuthService;
  renderWithApp(
    <RequireAuth />,
    new Container().register(IdentityToken, identity).register(AuthServiceToken, auth),
  );
  signedOut();
  expect(identity.goToLogin).toHaveBeenCalled();
  expect(identity.goToLoginGuarded).not.toHaveBeenCalled();
});

it('offers a retry when the session cannot be loaded (FasorX or the API down)', async () => {
  const identity = { enabled: true, watch: () => () => {} } as unknown as FasorxIdentity;
  const auth = { me: vi.fn().mockRejectedValue(new Error('token: 502')) } as unknown as AuthService;
  renderWithApp(
    <RequireAuth />,
    new Container().register(IdentityToken, identity).register(AuthServiceToken, auth),
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
  await waitFor(() => expect(auth.me).toHaveBeenCalledTimes(2));
});
