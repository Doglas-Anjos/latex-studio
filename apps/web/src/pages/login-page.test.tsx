// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { ApiError } from '../services/api-client';
import { type AuthService, AuthServiceToken, type User } from '../services/auth.service';
import { renderWithApp } from '../test/render';
import { LoginPage } from './login-page';

const user: User = {
  id: '1',
  email: 'a@b.co',
  name: 'A',
  role: 'user',
  status: 'active',
  createdAt: '2026-01-01',
};

function setup(login: AuthService['login']) {
  const auth: AuthService = { login, register: vi.fn(), logout: vi.fn(), me: vi.fn() };
  renderWithApp(<LoginPage />, new Container().register(AuthServiceToken, auth));
}

async function submit() {
  await userEvent.type(screen.getByLabelText('E-mail'), 'a@b.co');
  await userEvent.type(screen.getByLabelText('Senha'), 'secret123');
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('LoginPage', () => {
  afterEach(cleanup);

  it('sends the credentials to AuthService.login', async () => {
    const login = vi.fn().mockResolvedValue(user);
    setup(login);
    await submit();
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({ email: 'a@b.co', password: 'secret123' }),
    );
  });

  it('shows an inline message on 401', async () => {
    setup(vi.fn().mockRejectedValue(new ApiError(401, 'Unauthorized')));
    await submit();
    expect((await screen.findByRole('alert')).textContent).toBe('E-mail ou senha inválidos');
  });
});
