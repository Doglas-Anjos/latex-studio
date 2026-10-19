// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../workspace-store';
import { initials, PresenceAvatars } from './presence-avatars';

describe('initials', () => {
  it('takes first and last initials, uppercased', () => {
    expect(initials('Ana Silva')).toBe('AS');
    expect(initials('bruno')).toBe('B');
    expect(initials('  maria  clara  souza ')).toBe('MS');
    expect(initials('')).toBe('?');
  });
});

describe('PresenceAvatars', () => {
  afterEach(() => {
    useWorkspaceStore.setState({ peers: [] });
    cleanup();
  });

  it('shows one circle per person (deduped by account) and a +N overflow', () => {
    useWorkspaceStore.setState({
      peers: [
        { id: 1, userId: 'ana', name: 'Ana Silva', color: '#111111' },
        { id: 2, userId: 'ana', name: 'Ana Silva', color: '#111111' }, // same person, second tab
        { id: 3, userId: 'bruno', name: 'Bruno Lima', color: '#222222' },
        { id: 4, userId: 'carla', name: 'Carla Souza', color: '#333333' },
        { id: 5, userId: 'davi', name: 'Davi Rocha', color: '#444444' },
      ],
    });
    render(<PresenceAvatars />);
    expect(screen.getByText('AS')).toBeTruthy();
    expect(screen.getByText('BL')).toBeTruthy();
    expect(screen.getByText('CS')).toBeTruthy();
    expect(screen.queryByText('DR')).toBeNull(); // past the cap
    expect(screen.getByText('+1')).toBeTruthy();
  });

  it('renders nothing when nobody else is editing', () => {
    const { container } = render(<PresenceAvatars />);
    expect(container.firstChild).toBeNull();
  });
});
