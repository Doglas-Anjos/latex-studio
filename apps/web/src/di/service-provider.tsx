import { createContext, type ReactNode, use } from 'react';
import type { Container, Token } from './container';

const ContainerContext = createContext<Container | null>(null);

export function ServiceProvider({
  container,
  children,
}: {
  container: Container;
  children: ReactNode;
}) {
  return <ContainerContext value={container}>{children}</ContainerContext>;
}

export function useService<T>(token: Token<T>): T {
  const container = use(ContainerContext);
  if (!container) throw new Error('useService must be used inside <ServiceProvider>');
  return container.get(token);
}
