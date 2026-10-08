// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type Member, type MemberService, MemberServiceToken } from '../services/member.service';
import { renderWithApp } from '../test/render';
import { MembersPanel } from './members-panel';

const members: Member[] = [
  { userId: 'u1', name: 'Dona Autora', email: 'dona@example.com', role: 'owner' },
  { userId: 'u2', name: 'Ana', email: 'ana@example.com', role: 'viewer' },
];

function fakeService(overrides: Partial<MemberService> = {}): MemberService {
  return {
    list: vi.fn().mockResolvedValue(members),
    invite: vi.fn().mockResolvedValue(members),
    setRole: vi.fn().mockResolvedValue(members),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('MembersPanel', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });
  afterEach(cleanup);

  it('lists members with initials, chip and role select for the owner', async () => {
    const service = fakeService();
    renderWithApp(
      <MembersPanel project={{ id: 'p1', name: 'Tese' }} isOwner />,
      new Container().register(MemberServiceToken, service),
    );
    expect(await screen.findByText('ana@example.com')).toBeTruthy();
    expect(screen.getByText('DA')).toBeTruthy();
    expect(screen.getByText('Dono')).toBeTruthy();
    expect(screen.getByLabelText('Papel de Ana')).toBeTruthy();
  });

  it('shows an error with retry when the list fails to load', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(members);
    const service = fakeService({ list });
    renderWithApp(
      <MembersPanel project={{ id: 'p1', name: 'Tese' }} isOwner />,
      new Container().register(MemberServiceToken, service),
    );
    expect(await screen.findByText('Não foi possível carregar os membros.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('ana@example.com')).toBeTruthy();
  });

  it('invites a member through the dialog and resets the form after success', async () => {
    const invite = vi.fn().mockResolvedValue(members);
    const service = fakeService({ invite });
    renderWithApp(
      <MembersPanel project={{ id: 'p1', name: 'Tese' }} isOwner />,
      new Container().register(MemberServiceToken, service),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Convidar membro' }));
    const dialog = screen.getByRole('dialog', { name: 'Compartilhar projeto' });
    const emailField = within(dialog).getByLabelText('E-mail');
    expect(within(dialog).getByText('Tese')).toBeTruthy();
    expect(emailField).toBe(document.activeElement);
    await userEvent.type(emailField, 'novo@example.com');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Revisor/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar convite' }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith('p1', 'novo@example.com', 'reviewer'));
  });

  it('keeps the invite dialog open and the typed email on failure', async () => {
    const invite = vi.fn().mockRejectedValue(new Error('E-mail já convidado'));
    const service = fakeService({ invite });
    renderWithApp(
      <MembersPanel project={{ id: 'p1', name: 'Tese' }} isOwner />,
      new Container().register(MemberServiceToken, service),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Convidar membro' }));
    const dialog = screen.getByRole('dialog', { name: 'Compartilhar projeto' });
    await userEvent.type(within(dialog).getByLabelText('E-mail'), 'novo@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar convite' }));
    expect(await within(dialog).findByText('E-mail já convidado')).toBeTruthy();
    expect((within(dialog).getByLabelText('E-mail') as HTMLInputElement).value).toBe(
      'novo@example.com',
    );
  });

  it('asks for confirmation before removing a member, and cancel keeps it', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = fakeService({ remove });
    renderWithApp(
      <MembersPanel project={{ id: 'p1', name: 'Tese' }} isOwner />,
      new Container().register(MemberServiceToken, service),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Remover Ana' }));
    const confirmDialog = screen.getByRole('dialog', { name: 'Remover membro' });
    expect(within(confirmDialog).getByText(/ana@example\.com/)).toBeTruthy();
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancelar' }));
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: 'Remover Ana' }));
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('p1', 'u2'));
  });

  it('hides the invite button and role controls for a non-owner', async () => {
    const service = fakeService();
    renderWithApp(
      <MembersPanel project={{ id: 'p1', name: 'Tese' }} isOwner={false} />,
      new Container().register(MemberServiceToken, service),
    );
    await screen.findByText('ana@example.com');
    expect(screen.queryByRole('button', { name: 'Convidar membro' })).toBeNull();
    expect(screen.queryByLabelText('Papel de Ana')).toBeNull();
    expect(screen.getByText('Leitor', { selector: '.role-chip-static' })).toBeTruthy();
  });
});
