// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type Member, type MemberService, MemberServiceToken } from '../services/member.service';
import { renderWithApp } from '../test/render';
import { MembersPanel } from './members-panel';

const members: Member[] = [
  { userId: 'u1', name: 'Dona', email: 'dona@example.com', role: 'owner' },
  { userId: 'u2', name: 'Ana', email: 'ana@example.com', role: 'viewer' },
];

it('lists members and lets the owner remove one', async () => {
  const service: MemberService = {
    list: async () => members,
    invite: vi.fn(async () => members),
    setRole: vi.fn(async () => members),
    remove: vi.fn(async () => undefined),
  };
  renderWithApp(
    <MembersPanel projectId="p1" isOwner />,
    new Container().register(MemberServiceToken, service),
  );
  expect(await screen.findByText('ana@example.com')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Remover' }));
  expect(service.remove).toHaveBeenCalledWith('p1', 'u2');
});
