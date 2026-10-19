# LaTeX Studio

Editor LaTeX colaborativo, no estilo do Overleaf, com três diferenças de premissa:

- **Cada projeto é um repositório Git.** Histórico, diff e restauração vêm do Git, não de um formato próprio.
- **Bibliotecas gerenciadas por manifesto.** Pacotes LaTeX são ligados e desligados em um painel, sem comentar código: um pacote desligado que ainda aparece como `\usepackage` no `.tex` é pulado pelo LaTeX (o `latex-packages.tex` gerado define `\ver@<pacote>.sty`), e o zip exportado compila em qualquer lugar.
- **Compilação em fila isolada.** Um worker com TeX Live compila sem shell-escape, sem rede, com tempo e memória limitados.

Mantém o essencial: edição simultânea (Yjs, com cursores nomeados), comentários de revisão, importação por zip ou pasta, exportação (fonte, PDF, DOCX, Markdown, HTML).

A interface segue o modelo do VS Code: barra de atividades, sidebar redimensionável, abas, painel de compilação e barra de status. "Mudanças" mostra o que mudou desde a última versão salva (marcas na margem, lista de arquivos, diff lado a lado), o histórico compara versões, o botão Blame mostra quem alterou cada linha, e Auto-indent formata com `latexindent` (no worker) ou com o indentador do editor quando ele não existe. Tema claro/escuro e cores de sintaxe são editáveis pelo usuário (engrenagem), guardados no navegador.

**Não tem login próprio.** Quem autentica é a aplicação na frente (FasorX): ela emite um JWT curto para o navegador, que o apresenta em `Authorization: Bearer`, e a API só verifica a assinatura. Localmente, sem verificador configurado, tudo roda como um usuário local, sem cadastro; nesse modo a API só escuta em localhost (salvo com o [compartilhamento em rede local](#compartilhar-um-projeto-na-rede-local-lan) ligado) e não sobe com `NODE_ENV=production`, então um servidor (Docker Compose incluso) sempre precisa das variáveis `AUTH_*`.

Arquitetura completa em [docs/architecture.md](docs/architecture.md).

## Stack

TypeScript em todo o projeto. NestJS (Fastify) + Hocuspocus na API, worker NestJS com BullMQ, React + Vite + CodeMirror 6 + PDF.js no frontend, PostgreSQL (Drizzle), Redis, isomorphic-git, Caddy.

## Subir em produção (Docker Compose)

Requisitos: Docker com Compose e uma VPS com 2 vCPU, 4 GB de RAM (~100 usuários) e uns 15 GB de disco livre (a imagem do worker com o TeX Live completo tem ~6 GB).

```bash
cp .env.example .env
docker compose up -d --build
```

No `.env`, antes de subir:

- `APP_DOMAIN` e `APP_URL=https://<APP_DOMAIN>`;
- senhas novas em `POSTGRES_PASSWORD` (repita em `DATABASE_URL`) e `REDIS_PASSWORD` (repita em `REDIS_URL`);
- as variáveis `AUTH_*` do emissor dos tokens (o FasorX ou outro provedor OIDC, abaixo) e `VITE_FASORX_URL`. Sem verificador a API se recusa a subir: o compose roda com `NODE_ENV=production`, onde o modo local não existe.

O Caddy obtém TLS automaticamente para `APP_DOMAIN`. Quem pode entrar é decidido pelo FasorX; a primeira visita cria a conta aqui. Para convidar alguém para um projeto, a pessoa precisa ter aberto o app ao menos uma vez.

### Publicação no servidor do FasorX

A instância do FasorX (`latex.fasorx.com.br`) é publicada pelo job `publish` do CI a cada push verde na `main`: ele gera o `.env` do servidor a partir dos segredos do ambiente `producao` do GitHub (nada fica em arquivo versionado) e roda [scripts/deploy-fasorx.sh](scripts/deploy-fasorx.sh), que constrói, sobe, confere a saúde e volta à versão anterior se algo falhar. O Caddy interno fica só em `127.0.0.1:3010` ([docker-compose.fasorx.yml](docker-compose.fasorx.yml)); TLS e domínio são do Caddy do servidor. O job fica desligado até a variável de repositório `PUBLISH_TARGET` valer `fasorx`; os segredos necessários estão no comentário do job em [.github/workflows/ci.yml](.github/workflows/ci.yml).

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

- **Jobs em paralelo por worker** (variáveis de ambiente): `COMPILE_CONCURRENCY` (compilações simultâneas) e `TOOLS_CONCURRENCY` (export/wordcount/auto-indent simultâneos). Padrão 1 cada. Cada compilação pode usar até `COMPILE_MEMORY_MB`, então dimensione pela CPU/RAM da máquina e suba junto o `mem_limit` do worker no `docker-compose.yml` (cerca de N × `COMPILE_MEMORY_MB` + 512 MB).
- **Número de workers** (escala horizontal): rode mais contêineres worker com `docker compose up -d --scale worker=N`. Eles dividem a mesma fila (Redis/BullMQ), sem configuração extra.

As duas alavancas são lidas no boot: depois de mudar, reinicie os workers (`docker compose up -d` recria quem mudou). Como referência, uma VPS de 2 vCPU/4 GB atende ~100 usuários com os padrões.

Cotas de armazenamento: `PROJECT_QUOTA_MB` por projeto e, opcional, `USER_QUOTA_MB` somando todos os projetos de cada dono (o que colaboradores gravam conta para o dono); vazio = sem teto por usuário.

Backup noturno (dump do Postgres + tar dos repositórios): `./scripts/backup.sh /srv/backups` via cron.

## Desenvolvimento

Requisitos: Node 22.22 ou superior, pnpm 12 (`npm i -g pnpm`), Docker, e um TeX Live ou MiKTeX com `latexmk` no PATH para compilar localmente.

```bash
pnpm install
cp .env.example .env
```

No `.env`, troque estas linhas (com `AUTH_*` e `VITE_FASORX_URL` vazios, como vêm, é o modo local: sem login, a API só escuta em localhost):

```bash
APP_URL=http://localhost:5173
DATABASE_URL=postgres://latex:change-me@localhost:5432/latex
REDIS_URL=redis://:change-me@localhost:6379
REPOS_DIR=/caminho/absoluto/latex-studio/data/repos     # a pasta data/ já é ignorada pelo git
BUILDS_DIR=/caminho/absoluto/latex-studio/data/builds
```

```bash
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

## Compartilhar um projeto na rede local (LAN)

Rodando localmente, você pode abrir um projeto para outras pessoas na mesma rede (casa, laboratório, sala de aula). Cada pessoa recebe um PIN de 4 dígitos e edita pelo navegador, sem conta e sem instalar nada.

É uma comodidade para rede de confiança, não um login de verdade, por isso só existe no modo local da seção anterior. **Subir o Docker Compose não publica nada:** o compose roda em produção (`NODE_ENV=production`), onde o compartilhamento em rede local é recusado. Além disso, dentro do Docker todo acesso chega pelo IP do Caddy, e a API não teria como saber quem é o anfitrião.

### 1. Ligar no `.env`

Além das linhas do modo local:

```bash
APP_URL=http://localhost:5173   # o link dos amigos usa esta porta; mude junto se mudar a do Vite
LAN_SHARE=true
LAN_SECRET=                     # 32 caracteres ou mais, aleatórios (comando abaixo)
```

Para gerar o `LAN_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Deixe `NODE_ENV=development` e as variáveis `AUTH_*` vazias. Se algo estiver fora disso, a API não sobe e avisa: `LAN_SHARE needs LAN_SECRET, no AUTH_JWKS_URL/AUTH_SECRET, and is only allowed when APP_URL is localhost and NODE_ENV is not production`.

### 2. Subir com o frontend aberto para a rede

API e worker sobem como na seção anterior; com `LAN_SHARE`, a API passa a escutar em todas as interfaces. O frontend precisa do `--host`, senão só a sua máquina o alcança:

```bash
pnpm --filter @latex-studio/web dev --host 0.0.0.0
```

Libere a porta 5173 no firewall. No Windows, aceite o aviso do firewall para o Node marcando **Redes privadas**, e confira se a rede Wi-Fi está como privada. Se você recusou o aviso, libere em Firewall do Windows Defender → Permitir um aplicativo. No Linux: `sudo ufw allow 5173/tcp`.

### 3. Publicar (no seu computador)

Abra o app em **http://localhost:5173**. Só quem acessa pela própria máquina (localhost) é o anfitrião; quem entra pelo IP da rede é sempre convidado.

1. Na tela inicial, ligue **Acesso remoto (LAN)**. Ele começa desligado toda vez que a API sobe, então reiniciar o servidor sempre fecha a porta.
2. No projeto, clique em **Compartilhar** (no cabeçalho ou no ícone da lista de projetos) e depois em **Publicar na rede**.
3. Em **Pessoas com acesso**, digite o nome de cada amigo e clique em **Adicionar**. O PIN aparece **uma única vez**: anote ou mande na hora.
4. Copie o **Link para compartilhar** (`http://<seu-ip>:5173/join/<projeto>`). Se o computador tiver mais de um endereço (Wi-Fi, VPN, WSL), escolha na lista o da rede dos amigos.

### 4. Entrar (no computador do amigo)

O amigo abre o link, digita o PIN e edita o projeto como editor. O nome dele aparece nos avatares e nas linhas que ele altera, com uma cor própria. Ele vê só os projetos compartilhados com ele e não cria nem importa projetos. A sessão dura 12 horas; depois disso, é preciso digitar o PIN de novo.

### Encerrar

- **Todo mundo, na hora:** desligue **Acesso remoto (LAN)**. Ninguém entra, nem com PIN, e quem estiver editando é desconectado. Se você religar em menos de 12 horas, quem já tinha entrado volta sem digitar o PIN.
- **Um projeto:** **Parar de compartilhar** no diálogo de compartilhamento.
- **Uma pessoa:** **Remover** (lixeira) ao lado do nome. O PIN dela deixa de valer.

Erros de PIN são limitados: 5 erros seguidos bloqueiam aquele computador por alguns minutos, e 30 erros num projeto bloqueiam o projeto inteiro por um tempo.

### Problemas comuns

- **O amigo não abre o link:**
  - confira o firewall e o `--host 0.0.0.0`;
  - confira se ele está na mesma rede (redes Wi-Fi de visitante costumam isolar os aparelhos);
  - tente outro endereço da lista.
- **"O anfitrião desligou o acesso remoto":** ligue **Acesso remoto (LAN)** na tela inicial.
- **O interruptor não aparece:** faltam `LAN_SHARE`/`LAN_SECRET` no `.env`, ou você não está em `http://localhost:5173`.
- **"PIN inválido ou projeto indisponível":** o PIN está errado, ou o projeto não está publicado.

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

AGPL-3.0-only. Veja [LICENSE](LICENSE). Avisos de terceiros (skills, fontes, PDF.js, KaTeX, dicionários): [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

O corretor ortográfico usa dicionários Hunspell de terceiros, cada um sob a própria licença:
- Português (pacote `dictionary-pt`): dicionário VERO de Raimundo Moura, sob LGPL-3.0 ou MPL-2.0.
- Inglês (pacote `dictionary-en`): derivado do SCOWL, sob MIT e BSD.
