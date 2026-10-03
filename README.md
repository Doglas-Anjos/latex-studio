# LaTeX Studio

Editor LaTeX colaborativo, no estilo do Overleaf, com três diferenças de premissa:

- **Cada projeto é um repositório Git.** Histórico, diff e restauração vêm do Git, não de um formato próprio.
- **Bibliotecas gerenciadas por manifesto.** Pacotes LaTeX são ligados e desligados em um painel; o arquivo `latex-packages.tex` é gerado a partir de `latex-packages.json` e o zip exportado compila em qualquer lugar.
- **Compilação em fila isolada.** Um worker com TeX Live compila sem shell-escape, sem rede, com tempo e memória limitados.

Mantém o essencial: edição simultânea (Yjs), comentários de revisão, importação por zip ou pasta, exportação (fonte, PDF, DOCX, Markdown, HTML).

**Não tem login próprio.** Quem autentica é a aplicação na frente (FasorX): ela emite um JWT curto para o navegador, que o apresenta em `Authorization: Bearer`, e a API só verifica a assinatura. Localmente, sem verificador configurado, tudo roda como um usuário local, sem cadastro.

Arquitetura completa em [docs/architecture.md](docs/architecture.md).

## Stack

TypeScript em todo o projeto. NestJS (Fastify) + Hocuspocus na API, worker NestJS com BullMQ, React + Vite + CodeMirror 6 + PDF.js no frontend, PostgreSQL (Drizzle), Redis, isomorphic-git, Caddy.

## Subir em produção (Docker Compose)

Requisitos: Docker com Compose, uma VPS com 2 vCPU e 4 GB RAM é suficiente para ~100 usuários.

```bash
cp .env.example .env   # preencha senhas e as variáveis AUTH_* / VITE_FASORX_*
docker compose up -d --build
```

O Caddy obtém TLS automaticamente para `APP_DOMAIN`. Quem pode entrar é decidido pelo FasorX; a primeira visita cria a conta aqui. Para convidar alguém para um projeto, a pessoa precisa ter aberto o app ao menos uma vez.

### Contrato com o FasorX

- O navegador faz `POST {VITE_FASORX_URL}/api/token/{VITE_FASORX_APP}` com o cookie de sessão do FasorX e recebe `{ token, validade, pessoa, sair }`; sem sessão vai para `{VITE_FASORX_URL}/entrar/?volta={VITE_FASORX_APP}`.
- O token é um JWT (RS256 publicado em `AUTH_JWKS_URL`, ou HS256 com `AUTH_SECRET`) com `iss`, `aud` (= `AUTH_AUDIENCE`, só desta aplicação), `sub` estável, `exp` de no máximo `AUTH_MAX_TOKEN_TTL_S`, e as claims `email` e `name`, que viram a conta aqui.
- Quem pode usar o app é decidido no FasorX: ele só deve emitir o token `latex` para quem tem direito, pois aqui não há aprovação nem bloqueio.

Backup noturno (dump do Postgres + tar dos repositórios): `./scripts/backup.sh /srv/backups` via cron.

## Desenvolvimento

Requisitos: Node 22.22 ou superior, pnpm 12 (`npm i -g pnpm`), Docker, e um TeX Live ou MiKTeX com `latexmk` no PATH para compilar localmente.

```bash
pnpm install
cp .env.example .env            # DATABASE_URL/REDIS_URL para localhost; AUTH_* e VITE_FASORX_* vazios = sem login
docker compose -f docker-compose.dev.yml up -d    # Postgres em 5432 e Redis em 6379 (POSTGRES_PORT/REDIS_PORT mudam)
pnpm build                      # compila os pacotes compartilhados (packages/*)
pnpm --filter @latex-studio/api dev               # lê o .env da raiz automaticamente
pnpm --filter @latex-studio/worker dev
pnpm --filter @latex-studio/web dev               # http://localhost:5173, com proxy para a API
```

Verificações: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Os pacotes em `packages/` precisam estar compilados (`pnpm build`) antes do typecheck dos apps.

## Layout

```
apps/api        API NestJS: identidade (JWT do FasorX), projects, files, collab (Yjs), compile, packages, export
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
