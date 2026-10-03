# LaTeX Studio

Editor LaTeX colaborativo, no estilo do Overleaf, com três diferenças de premissa:

- **Cada projeto é um repositório Git.** Histórico, diff e restauração vêm do Git, não de um formato próprio.
- **Bibliotecas gerenciadas por manifesto.** Pacotes LaTeX são ligados e desligados em um painel; o arquivo `latex-packages.tex` é gerado a partir de `latex-packages.json` e o zip exportado compila em qualquer lugar.
- **Compilação em fila isolada.** Um worker com TeX Live compila sem shell-escape, sem rede, com tempo e memória limitados.

Mantém o essencial: edição simultânea (Yjs), comentários de revisão, importação por zip ou pasta, exportação (fonte, PDF, DOCX, Markdown, HTML).

Arquitetura completa em [docs/architecture.md](docs/architecture.md).

## Stack

TypeScript em todo o projeto. NestJS (Fastify) + Hocuspocus na API, worker NestJS com BullMQ, React + Vite + CodeMirror 6 + PDF.js no frontend, PostgreSQL (Drizzle), Redis, isomorphic-git, Caddy.

## Subir em produção (Docker Compose)

Requisitos: Docker com Compose, uma VPS com 2 vCPU e 4 GB RAM é suficiente para ~100 usuários.

```bash
cp .env.example .env   # preencha senhas, SESSION_SECRET (openssl rand -hex 64), ADMIN_*
docker compose up -d --build
```

O Caddy obtém TLS automaticamente para `APP_DOMAIN`. O primeiro admin é criado na primeira subida com `ADMIN_EMAIL` e `ADMIN_PASSWORD`. Novos cadastros ficam pendentes até um admin aprovar em **Admin → Usuários**.

Backup noturno (dump do Postgres + tar dos repositórios): `./scripts/backup.sh /srv/backups` via cron.

## Desenvolvimento

Requisitos: Node 22.22 ou superior, pnpm 12 (`npm i -g pnpm`), Docker, e um TeX Live ou MiKTeX com `latexmk` no PATH para compilar localmente.

```bash
pnpm install
cp .env.example .env            # ajuste DATABASE_URL/REDIS_URL para localhost (portas abaixo)
docker compose -f docker-compose.dev.yml up -d    # Postgres em 5432 e Redis em 6379 (POSTGRES_PORT/REDIS_PORT mudam)
pnpm build                      # compila os pacotes compartilhados (packages/*)
pnpm --filter @latex-studio/api dev               # lê o .env da raiz automaticamente
pnpm --filter @latex-studio/worker dev
pnpm --filter @latex-studio/web dev               # http://localhost:5173, com proxy para a API
```

Verificações: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Os pacotes em `packages/` precisam estar compilados (`pnpm build`) antes do typecheck dos apps.

## Layout

```
apps/api        API NestJS: auth, admin, projects, files, collab (Yjs), compile, packages, export
apps/worker     Fila: compilação latexmk em sandbox, autocommit
apps/web        React: projetos, editor colaborativo, PDF, bibliotecas, builds
packages/core   Config validada, banco (Drizzle + migrações), fila, SafePath
packages/git-store, packages/latex-tools   Classes puras (git, parsers LaTeX)
docker/         Imagens da API, do worker (TeX Live) e do web (Caddy)
```

## Segurança

Resumo em [SECURITY.md](SECURITY.md) e na seção "Segurança" de [docs/architecture.md](docs/architecture.md). Vulnerabilidades: use o aviso de segurança privado do GitHub.

## Licença

AGPL-3.0. Veja [LICENSE](LICENSE).
