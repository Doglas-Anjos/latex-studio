# LaTeX Studio

Editor LaTeX colaborativo, no estilo do Overleaf, com três diferenças de premissa:

- **Cada projeto é um repositório Git.** Histórico, diff e restauração vêm do Git, não de um formato próprio.
- **Bibliotecas gerenciadas por manifesto.** Pacotes LaTeX são ligados e desligados em um painel, sem comentar código: um pacote desligado que ainda aparece como `\usepackage` no `.tex` é pulado pelo LaTeX (o `latex-packages.tex` gerado define `\ver@<pacote>.sty`), e o zip exportado compila em qualquer lugar.
- **Compilação em fila isolada.** Um worker com TeX Live compila sem shell-escape, sem rede, com tempo e memória limitados.

Mantém o essencial: edição simultânea (Yjs, com cursores nomeados), comentários de revisão, importação por zip ou pasta, exportação (fonte, PDF, DOCX, Markdown, HTML).

A interface segue o modelo do VS Code: barra de atividades, sidebar redimensionável, abas, painel de compilação e barra de status. "Mudanças" mostra o que mudou desde a última versão salva (marcas na margem, lista de arquivos, diff lado a lado), o histórico compara versões, o botão Blame mostra quem alterou cada linha, e Auto-indent formata com `latexindent` (no worker) ou com o indentador do editor quando ele não existe. Tema claro/escuro e cores de sintaxe são editáveis pelo usuário (engrenagem), guardados no navegador.

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

### Conectar outro provedor de identidade (OIDC): Entra ID/Azure AD, Keycloak, AD

O app não tem login próprio: ele confia num JWT assinado que chega no header `Authorization`. O FasorX é só o emissor padrão — qualquer provedor OIDC serve. Para uma instalação de universidade sem o FasorX, aponte as variáveis `AUTH_*` para o seu provedor:

- `AUTH_JWKS_URL` → o JWKS do provedor (RS256). Entra ID/Azure AD: `https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys`; Keycloak: `https://<host>/realms/<realm>/protocol/openid-connect/certs`. Use `AUTH_SECRET` (≥32 bytes) só para HS256 com segredo compartilhado.
- `AUTH_ISSUER` → o `iss` do provedor (Entra: `https://login.microsoftonline.com/<tenant-id>/v2.0`; Keycloak: `https://<host>/realms/<realm>`).
- `AUTH_AUDIENCE` → o `aud` desta aplicação (o Application/Client ID que você registrar no provedor).
- O token precisa trazer `sub` estável, `email` e `name`, e `exp` dentro de `AUTH_MAX_TOKEN_TTL_S`.

**Active Directory on-prem** não emite JWT (fala LDAP/Kerberos): ponha um **ADFS**, o **Entra ID** (via Azure AD Connect) ou o **Keycloak** federando o diretório na frente — aí vira OIDC e cai nas variáveis acima. O front web (`VITE_FASORX_*`) espera o fluxo do FasorX; para outro provedor, o deploy faz o login no provedor e entrega o JWT ao app (a verificação no backend é a mesma).

**Quem pode entrar** é decidido no provedor: só emita o token desta aplicação para os usuários/grupos autorizados — aqui não há aprovação nem bloqueio próprios. Admins da plataforma (veem e governam tudo) saem de `SUPERADMIN_EMAILS` (lista de e-mails separados por vírgula). Dentro de cada projeto, o acesso é por papel (dono/editor/revisor/leitor).

### Capacidade e workers

A capacidade de processamento tem duas alavancas independentes:

- **Jobs em paralelo por worker** (variáveis de ambiente): `COMPILE_CONCURRENCY` (compilações simultâneas) e `TOOLS_CONCURRENCY` (export/wordcount/auto-indent simultâneos). Padrão 1 cada. Cada compilação pode usar até `COMPILE_MEMORY_MB`, então dimensione pela CPU/RAM da máquina.
- **Número de workers** (escala horizontal): rode mais contêineres worker com `docker compose up -d --scale worker=N`. Eles dividem a mesma fila (Redis/BullMQ), sem configuração extra.

As duas alavancas são lidas no boot: depois de mudar, reinicie os workers (`docker compose up -d` recria quem mudou). Como referência, uma VPS de 2 vCPU/4 GB atende ~100 usuários com os padrões.

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

No Windows com MiKTeX, rode o worker pelo PowerShell ou cmd (não pelo Git Bash/MSYS): o worker
repassa o `PATH` para o `latexmk`, e num ambiente MSYS o MiKTeX gera caminhos estilo `/tmp/...` que
o `bibtex` não resolve — o efeito é a bibliografia (`.bib`/`.bst`) não ser encontrada e as citações
saírem indefinidas. Em produção (contêiner Linux) isso não acontece.

Verificações: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Os pacotes em `packages/` precisam estar compilados (`pnpm build`) antes do typecheck dos apps.

## Layout

```
apps/api        API NestJS: identidade (JWT do FasorX), projects, files, collab (Yjs), compile, packages, export
apps/worker     Fila: compilação latexmk em sandbox, ferramentas (export, wordcount, format)
apps/web        React: dashboard, workspace (editor colaborativo, diff, blame, PDF, bibliotecas, builds)
packages/core   Config validada, banco (Drizzle + migrações), fila, SafePath
packages/git-store, packages/latex-tools   Classes puras (git, parsers LaTeX)
docker/         Imagens da API, do worker (TeX Live) e do web (Caddy)
```

## Corretor ortográfico

A verificação roda no servidor (Hunspell via WebAssembly, em `apps/api`), então dicionários de
qualquer tamanho funcionam. Hoje vêm português (Brasil) e inglês (EUA). Para **adicionar um idioma**
basta um dicionário Hunspell empacotado — a coleção [`dictionaries`](https://github.com/wooorm/dictionaries)
traz dezenas (`dictionary-es`, `dictionary-fr`, `dictionary-de`, `dictionary-it`, ...):

1. Instale o pacote na API: `pnpm --filter @latex-studio/api add dictionary-es`.
2. Em `apps/api/src/modules/spellcheck/infrastructure/hunspell-speller.ts`, mapeie o idioma:
   adicione a chave em `PACKAGE` (`es: 'dictionary-es'`) e um ramo em `dictKey`
   (`lang.startsWith('es') ? 'es' : ...`).
3. Libere a tag BCP-47 em `apps/api/src/modules/spellcheck/presentation/spellcheck.dto.ts`
   (`SPELL_LANGS`, ex.: `'es-ES'`) — o endpoint recusa idiomas fora dessa lista.
4. Ofereça no seletor em `apps/web/src/components/settings-dialog.tsx` (`SPELL_LANGS`,
   ex.: `['es-ES', 'Español']`).
5. Rebuild da API (`pnpm --filter @latex-studio/api build`) e cite a licença do dicionário na
   seção Licença abaixo.

Cada dicionário carrega uma vez e fica em memória; não há limite prático de idiomas além da RAM.

## Segurança

Resumo em [SECURITY.md](SECURITY.md) e na seção "Segurança" de [docs/architecture.md](docs/architecture.md). Vulnerabilidades: use o aviso de segurança privado do GitHub.

## Licença

AGPL-3.0. Veja [LICENSE](LICENSE).

O corretor ortográfico usa dicionários Hunspell de terceiros, cada um sob a própria licença:
- Português (pacote `dictionary-pt`): dicionário VERO de Raimundo Moura, sob LGPL-3.0 ou MPL-2.0.
- Inglês (pacote `dictionary-en`): derivado do SCOWL, sob MIT e BSD.
