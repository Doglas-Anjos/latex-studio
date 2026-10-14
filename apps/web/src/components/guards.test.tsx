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

it('shows the 401 message instead of redirecting again when the login breaker is open', async () => {
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
  expect(identity.goToLoginGuarded).toHaveBeenCalled();
  expect(identity.goToLogin).not.toHaveBeenCalled();
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
