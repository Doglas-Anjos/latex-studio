import type { ReactNode } from 'react';

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <p className="brand">LaTeX Studio</p>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}
