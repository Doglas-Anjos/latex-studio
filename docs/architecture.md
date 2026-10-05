# Plano de arquitetura: editor LaTeX colaborativo com Git nativo

## Contexto

Construir do zero (pasta `C:\Projetos\Overleaf` está vazia) uma plataforma estilo Overleaf com três diferenças de premissa:

1. **Cada projeto é um repositório Git** (histórico, diff, restaurar versão, commits nomeados), não um "histórico" proprietário.
2. **Gerenciador de bibliotecas**: pacotes LaTeX ligados/desligados por um painel, sem comentar `\usepackage` no código.
3. **Fila de compilação isolada** com limites de recurso, porque o servidor é pequeno (2 vCPU / 4 GB RAM, ~100 usuários) e o código será público no GitHub e hospedado em VPS própria com Docker.

Mantém do Overleaf: edição simultânea (CRDT), comentários de review, importação (zip ou vários arquivos) e exportação (source zip, PDF, DOCX, Markdown, HTML), além dos itens do menu da imagem (nova pasta, upload, fazer cópia, histórico, contagem de palavras).

Cadastro aberto, mas a conta só é ativada por um admin; rate limit em tudo.

---

## Passo 0: skills de apoio (skills.sh) e convenções

Antes de qualquer código, instalar na raiz do projeto as skills avaliadas no skills.sh (vão para `.claude/skills/` e são commitadas):

```
npx skills add kadajett/agent-nestjs-skills -a claude-code
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices -a claude-code
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-composition-patterns -a claude-code
npx skills add https://github.com/anthropics/skills --skill frontend-design -a claude-code
```

| Skill | Uso no projeto | Por quê essa |
|---|---|---|
| `nestjs-best-practices` (kadajett) | Backend: módulos, DI, guards, filtros, testes, segurança, DB | 28,9 mil instalações; 10 áreas incluindo `di-`, `arch-`, `security-`, `test-` |
| `vercel-react-best-practices` | Frontend: re-render, memoização, data fetching | 766 mil instalações; serve para React + Vite, não só Next |
| `vercel-composition-patterns` | Frontend: composição de componentes (slots, compound components, sem prop drilling) | 371 mil; é o guia de "como montar componentes" pedido |
| `frontend-design` (anthropics) | Frontend: tipografia, cor, layout do editor | 948 mil; evita UI genérica |

Descartadas: `practicalswan/nestjs` (3 instalações, foca em TypeORM), `iliaal/react-frontend` (291, foca em App Router/server actions), `tenequm/typescript-dev` (52, stack Hono).

**Convenção de commits**: uma linha, Conventional Commits, inglês, imperativo, ≤ 72 caracteres. Ex.: `feat(api): add compile queue with per-project dedupe`, `fix(web): keep comment anchors after restore`. Sem corpo, sem rodapé, exceto o `Co-Authored-By` exigido pelo ambiente.

**Estilo de código**: POO com injeção de dependência em todas as camadas (detalhes na seção "Arquitetura em camadas").

---

## Decisões de stack (recomendação)

| Camada | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript em tudo (monorepo pnpm) | Yjs, Hocuspocus e CodeMirror são JS; um só ecossistema, um só time |
| API + WebSocket | **NestJS (adaptador Fastify)** + Hocuspocus (Yjs) no **mesmo processo** | DI e módulos nativos (POO), Fastify por baixo mantém o consumo baixo; 100 usuários (~10–20 simultâneos) é carga leve |
| Fila | BullMQ sobre Redis (`@nestjs/bullmq`) | Dedupe por projeto, retry, timeout, prioridade, painel pronto |
| Worker de compilação | App NestJS "standalone" separado, **dentro de uma imagem com TeX Live + pandoc** | Mesmo container de DI e mesmos módulos compartilhados; evita montar `docker.sock` (equivale a root no host) |
| Banco | PostgreSQL 16 (ORM Drizzle) | Usuários, membros, comentários, jobs, auditoria, estado Yjs |
| Git | `isomorphic-git` (JS puro) | Nunca executa shell nem hooks; sem risco de injeção de comando |
| Frontend | React + Vite, CodeMirror 6 + `y-codemirror.next`, PDF.js | Editor colaborativo e visualizador com SyncTeX |
| Proxy | Caddy | TLS automático, config de 10 linhas |

### Orçamento de memória (4 GB)

| Serviço | Limite |
|---|---|
| Postgres | 384 MB |
| Redis | 96 MB |
| API (NestJS/Fastify + Hocuspocus) | 512 MB |
| Worker (Node + latexmk/pandoc) | 1,5 GB, **concorrência 1** (configurável para 2 com 768 MB cada) |
| Caddy + SO | restante |

A fila absorve picos: quem pedir compilação espera na fila com posição visível, em vez de derrubar o servidor.

---

## Layout do repositório (publicado no GitHub)

```
latex-studio/                      # nome provisório
  apps/
    web/          React + Vite (editor, PDF, painéis)
    api/          NestJS (Fastify) + Hocuspocus + REST + enfileira jobs
    worker/       NestJS standalone: consome fila (compile, export, wordcount, autocommit)
  packages/
    shared/       Tipos, DTOs e schemas zod compartilhados (API <-> web <-> worker)
    latex-tools/  Classes puras: LatexLogParser, UsepackageParser, PackageManifestWriter, catálogo
    git-store/    GitRepository (classe sobre isomorphic-git): commit, log, diff, readBlob, bundle
    core/         Módulos NestJS reutilizados por api e worker (config, db, queue, storage, git)
  docker/
    texlive/Dockerfile   TeX Live scheme-full + pandoc + texcount + Node (imagem do worker)
    api/Dockerfile
    web/Dockerfile       build estático servido pelo Caddy
  docker-compose.yml, docker-compose.prod.yml, Caddyfile, .env.example
  docs/ (arquitetura, segurança, deploy, modelo de ameaças)
  .github/workflows/ (lint, typecheck, test, build de imagens, CodeQL, dependabot)
  SECURITY.md, LICENSE (AGPL-3.0 sugerido, mesma do Overleaf; ou MIT)
```

Dados persistentes no host (volumes): `/data/repos/<projectId>/` (working tree + `.git`), `/data/builds/<projectId>/<buildId>/` (PDF, log, synctex; manter últimos 3), `/data/postgres`, `/data/redis`.

---

## Arquitetura em camadas (POO + injeção de dependência)

### Backend (NestJS)
Cada domínio é um módulo NestJS com três camadas, dependências sempre apontando para dentro:

```
apps/api/src/modules/<dominio>/
  <dominio>.module.ts          registra providers e faz o binding interface -> implementação
  presentation/                controllers, DTOs (class-validator), guards, WebSocket gateway
  application/                 services (casos de uso): orquestram, não sabem de HTTP nem de disco
  domain/                      entidades e interfaces (ports): IProjectRepository, IGitRepository...
  infrastructure/              adapters: DrizzleProjectRepository, IsomorphicGitRepository,
                               FsProjectStorage, BullCompileQueue
```

- Injeção por **token de interface** (`@Inject(PROJECT_REPOSITORY)`), nunca pela classe concreta, para que testes troquem o adapter por um fake em memória.
- Módulos: `auth`, `users`, `admin`, `projects`, `files`, `git`, `collab` (Hocuspocus), `packages`, `comments`, `compile`, `export`, `import`, `audit`. Módulos transversais em `packages/core`: `config` (schema zod validado no boot), `database` (Drizzle), `queue` (BullMQ), `storage` (caminhos seguros), `rate-limit`.
- Guards: `SessionGuard` (autenticação), `ProjectRoleGuard('editor')` (autorização por papel), `ActiveUserGuard` (conta aprovada). Filtros de exceção mapeiam erros de domínio (`ProjectNotFound`, `QuotaExceeded`) para HTTP.
- Worker reutiliza os mesmos módulos de `packages/core` e expõe `@Processor('compile')` classes: `CompileProcessor`, `ExportProcessor`, `WordCountProcessor`, `AutocommitProcessor`, cada uma delegando para um service injetado (`LatexmkRunner`, `PandocRunner`, `SandboxedProcess`).
- Testes: unit nos services com fakes de ports; e2e por módulo com `@nestjs/testing` + Postgres de teste; o worker tem teste de sandbox com `.tex` maliciosos.

### Frontend (React)
- **Serviços como classes** (`ApiClient`, `AuthService`, `ProjectService`, `CompileService`, `CollabService`, `CommentService`, `PackageService`), com interfaces e sem dependência de React.
- **Container de DI leve**: `ServiceProvider` (React Context) recebe um `Container` montado em `main.tsx`; componentes resolvem com `useService(ProjectServiceToken)`. Testes de componente montam o provider com fakes. Sem Inversify/tsyringe para não exigir decorators no bundle.
- **Estado**: TanStack Query para dados do servidor (os services são as `queryFn`), Zustand só para estado de UI (painel aberto, arquivo ativo). Yjs cuida do texto.
- **Componentes** seguem `vercel-composition-patterns`: compound components (`<Panel>`, `<Panel.Header>`), slots por children, sem prop drilling; `vercel-react-best-practices` para memoização e re-render do editor; `frontend-design` para a identidade visual.

---

## Modelo de dados (Postgres)

- `users` (issuer + subject do JWT, email, name) — criado na primeira visita; sem senha, sem sessão
- `projects` (owner, nome, main_file, engine `pdflatex|xelatex|lualatex`, quota_bytes, dirty_since)
- `project_members` (role `owner|editor|reviewer|viewer`) e `project_invites`
- `yjs_docs` (project_id, path, state bytea, updated_at) — estado CRDT por arquivo
- `comments` (project, path, anchor_start/anchor_end = Yjs RelativePosition serializadas, fallback `commit_sha + linha + trecho citado`, resolved, author) e `comment_replies`
- `jobs` (tipo, projeto, usuário, status, started/finished, exit_code, erro) e `builds` (job, commit_sha, pdf_path, log_path, parsed_errors jsonb)
- `audit_log` (ator, ação, alvo, ip, timestamp)
- `package_catalog` (seed estático de ~300 pacotes CTAN com descrição) — só para autocomplete

O **conteúdo dos arquivos não fica no banco**: a árvore de trabalho do Git no disco é a fonte da verdade; o Yjs é a camada "ao vivo" sobre ela.

---

## Fluxos principais

### 1. Edição simultânea + Git
- Um `Y.Doc` por arquivo de texto, nome `<projectId>/<path>`; Hocuspocus multiplexa vários docs em um WebSocket.
- `onAuthenticate`: valida o token do FasorX (enviado pelo provider), a Origin e o papel no projeto (viewer = somente leitura).
- `onLoadDocument`: carrega estado de `yjs_docs`; se não existir, cria a partir do arquivo no disco.
- `onStoreDocument` (debounce 2 s, máx 10 s): grava estado em `yjs_docs`, escreve o arquivo no working tree, marca projeto `dirty`.
- **Autocommit**: job repetido a cada 5 min commita projetos `dirty` como "Autosave" com co-autores = quem editou. Usuário também faz **commit nomeado** ("Salvar versão" com mensagem).
- **Histórico**: `git log` → lista; diff entre commits (lib `diff`); **restaurar arquivo/versão** = ler blob do commit e aplicar no `Y.Doc` como diff (diff-match-patch → operações Yjs) para não quebrar âncoras de comentários nem desconectar quem está editando.
- Binários (imagens, PDFs anexos) não passam pelo Yjs: upload direto → disco → commit.
- Fase 3: remoto GitHub por deploy key (push/pull), `git bundle` para "baixar com histórico".

### 2. Gerenciador de bibliotecas (pacotes)
- Arquivo versionado `latex-packages.json` na raiz do projeto: `[{ name, options, enabled, order, note }]`.
- A API regenera `latex-packages.tex` (só os habilitados, na ordem) a cada alteração e commita junto. O `main.tex` inclui `\input{latex-packages}` logo após `\documentclass`.
- Resultado: o zip exportado compila em qualquer lugar sem a plataforma.
- Painel "Bibliotecas": toggle, opções, reordenar (ordem importa, ex. `hyperref` por último), autocomplete do catálogo.
- **Migração**: na importação, `latex-tools` detecta `\usepackage` no preâmbulo e oferece "mover N pacotes para o gerenciador" (remove do `.tex`, adiciona ao manifesto, 1 commit).
- Pacote desligado mas usado no corpo → erro de compilação esperado; o parser de log aponta e o painel mostra "pacote X desligado".

### 3. Comentários de review
- Âncoras por `Y.RelativePosition` (sobrevivem a edições de outros). Fallback por commit + trecho citado para arquivos sem doc Yjs aberto.
- Papel `reviewer`: só lê e comenta. Threads, resolver, menção, reaberto.
- Entrega em tempo real pelo mesmo WebSocket (mensagem custom do Hocuspocus) — sem segundo canal.
- Fase 3: "sugestões" (track changes) em cima dos comentários.

### 4. Fila de compilação
- `POST /projects/:id/compile` → job BullMQ `compile` com `jobId = compile:<projectId>`: se já há um na fila para o projeto, substitui; se está rodando, enfileira 1 e descarta repetidos.
- Limites: 1 job ativo por projeto, 3 na fila por usuário, 10 pedidos/min/usuário.
- Worker copia snapshot do working tree para `/tmp/job-<id>/` (tmpfs), roda:
  `latexmk -<engine> -interaction=nonstopmode -halt-on-error -no-shell-escape -synctex=1 -output-directory=out main.tex` sob `timeout 180s`, `ulimit -v`, `openin_any=p` / `openout_any=p` no `texmf.cnf`.
- Container do worker: rede `internal` sem saída para a internet (precisa de Postgres e Redis), `read_only: true`, `tmpfs /tmp`, `init: true` (reap de zumbis), usuário sem privilégio, `cap_drop: ALL`, `security_opt: no-new-privileges`, `pids_limit: 256`, `mem_limit`; recebe só as variáveis que usa (sem segredos da API); Redis com senha; `latexmk -norc`, `HOME`/`TEXMF*` fora do snapshot (sem `lualatex --safer`: o luaotfload recusa rodar com ele; `shell_escape=f` e `openin_any`/`openout_any=p` seguem valendo para o Lua). Limitação conhecida: o TeX roda com o mesmo uid do worker; execução de código no TeX alcançaria Redis/Postgres. Opcional: runtime gVisor (`runsc`) na VPS.
- Saída: PDF + log + synctex em `/data/builds/...`; log parseado em erros/avisos (`latex-tools`); status (`queued → running → done|failed|timeout`, posição na fila) enviado ao cliente por WebSocket.
- PDF servido por rota autenticada com streaming; PDF.js com SyncTeX ida/volta.
- Mesma fila atende `export` (pandoc), `wordcount` (texcount) e `autocommit`, com prioridades (compile > export > autocommit).

### 5. Importação
- Zip: extração com proteção **zip-slip** (rejeita `..`, absolutos, symlinks), limite de entradas (5 000) e de tamanho descomprimido (500 MB) contra zip bomb, **descarta qualquer `.git/`** do zip (evita hooks injetados) e `latex-packages.*` suspeitos são validados.
- Vários arquivos/pastas: multipart com `webkitdirectory`, mesmas validações de caminho.
- Ambos geram commit inicial "Import", detectam `main.tex` (primeiro com `\documentclass`) e oferecem a migração de pacotes.
- Fase 3: importar de URL git.

### 6. Exportação (menu da imagem)
| Item | Implementação |
|---|---|
| Download as source (.zip) | zip do working tree sem `.git`, com `latex-packages.tex` gerado; opção "com histórico" via `git bundle` |
| Download as PDF | último build bem-sucedido |
| Export DOCX / Markdown / HTML | job `export` no worker: `pandoc main.tex --citeproc --bibliography=... -o saida.ext` no mesmo sandbox |
| Make a copy | clone do repo para novo projeto do usuário |
| Show version history | painel Git (log/diff/restore) |
| Word count | job `texcount` no worker |
| New file / New folder / Upload file | operações no working tree + Y.Doc + commit |

---

## Segurança (código público, servidor exposto)

- **Identidade**: sem login próprio. O FasorX autentica e assina um JWT curto (RS256 via JWKS ou HS256), apresentado em `Authorization: Bearer`; a API fixa o algoritmo, confere `iss`/`aud`/`exp` e um teto de validade, e cria a conta na primeira visita (`iss` + `sub`). Token só em memória no navegador, nunca em URL. Sem verificador configurado, modo local, aceito só em `localhost`. CSRF por header custom continua nas mutações.
- **Rate limit** (`@fastify/rate-limit` com Redis): API 300/min/IP; compile 10/min; uploads 50 MB/arquivo e quota 500 MB/projeto.
- **Autorização** em toda rota por papel no projeto; projetos privados por padrão, compartilhamento por convite.
- **Caminhos**: normalização, rejeição de `..`, absolutos, symlinks e nomes fora de allowlist; tudo resolvido dentro de `/data/repos/<id>/` e checado com `realpath`.
- **Git**: `isomorphic-git` não executa hooks nem shell; nenhum `exec` com string concatenada em lugar nenhum.
- **Sandbox de compilação**: sem rede, sem shell-escape, rootfs read-only, tmpfs, timeout, limites de memória/pids, usuário não-root, `openin_any=p`.
- **HTTP**: `@fastify/helmet`, CSP (liberar `worker-src blob:` para PDF.js), `X-Content-Type-Options`, PDFs com `Content-Disposition`.
- **Operação**: `.env` fora do repo, `.env.example` no repo, `SECURITY.md`, Dependabot + CodeQL, log de auditoria, backup noturno (`pg_dump` + tar de `/data/repos`).

---

## Estado em 3 de outubro de 2026

Implementado e verificado contra Postgres, Redis e MiKTeX locais (104 testes automatizados):

- Fase 1 completa: identidade delegada ao FasorX (JWT), projetos como repositórios git, arquivos, upload, importação zip/pasta, edição simultânea Yjs, fila de compilação com `latexmk` em sandbox, PDF, exportação de fonte e PDF.
- Fase 2 completa: gerenciador de bibliotecas com migração de `\usepackage`, comentários ancorados com Yjs, histórico git (log, diff, commit nomeado, restaurar) sincronizado com documentos abertos, cópia de projeto, contagem de palavras, exportações DOCX/MD/HTML via pandoc (não executado localmente: só na imagem Docker), compartilhamento por convite com papéis.
- Fase 3 parcial: rate limit em Redis, log de auditoria, backup por script, gitleaks e trivy no CI, Redis com senha, worker sem segredos da API, zip com histórico git.

Desvios do plano original, por revisão de segurança:

- Login, cadastro e aprovação por admin foram removidos: o projeto é público e a autenticação fica na aplicação da frente (FasorX), como no FitTradeoff. Convidar alguém exige que a pessoa já tenha aberto o app.
- O worker fica na rede interna com Postgres e Redis (precisa deles), não em `network_mode: none`; o TeX roda com o mesmo uid do worker.

Imagens `docker/api` e `docker/web` construídas e a da API testada em modo produção contra Postgres e Redis. Pendente: emissão do token `latex` no FasorX, remoto GitHub (push/pull) e importação por URL git, track changes, links de leitura, construção e teste da imagem `docker/texlive` (pandoc e latexindent só existem nela).

### Interface (4 de outubro de 2026)

- Dashboard estilo Overleaf (filtros, busca, tabela, hero), workspace estilo VS Code (barra de atividades, sidebar e PDF redimensionáveis, abas, painel de compilação, barra de status), tema claro/escuro/sistema e cores de sintaxe editáveis (`settings-store` persistido no navegador; `HighlightStyle` referencia variáveis CSS `--syn-*`).
- "Mudanças": linha de base = último commit não-`Autosave` (`GET history/status`), marcas na margem via `@codemirror/merge`, diff lado a lado (`MergeView`), descartar por arquivo (`restore`); histórico compara commits.
- Blame no servidor (`git-store` `blame`, jsdiff, cap 100 commits, 1 MB e 1 s de diff; commits e textos memorizados por HEAD) com gutter no editor; autosaves são commitados em nome de quem editou (tabela `file_edits` alimentada pelo hook `onChange` do Hocuspocus; vários editores no mesmo arquivo viram `Co-authored-by`).
- Auto-indent: job `format` (`latexindent` sobre o texto vivo enviado pelo cliente, num diretório temporário, sem `-l`, 15 s) aplicado no editor como mudanças mínimas só se o documento não mudou nesse meio-tempo; fallback para o indentador do CodeMirror; "Formatar projeto" grava os demais `.tex` via `PUT files/*`.
- Bibliotecas: bypass real para pacote desligado que o código ainda carrega (`\ver@`/`\opt@` em `latex-packages.tex`); pacote ligado que o código já carrega não é reemitido (evita "Option clash"); pacotes detectados no código aparecem no painel.

## Fases de implementação

**Fase 0 – Preparação**
0. `git init`, instalar as 4 skills do skills.sh, `.gitignore`, `.env.example`, commit `chore: bootstrap repo with agent skills`. **Você** roda uma vez no Claude Code (comandos interativos, não posso executá-los): `/plugin marketplace add DietrichGebert/ponytail` e `/plugin install ponytail@ponytail`. Como fallback, copio o ruleset do ponytail para `.claude/rules/ponytail.md` para valer também nos subagentes.

**Fase 1 – Fundação (MVP compilável)**
1. Monorepo pnpm, `packages/core` (config, db, queue, storage), lint/typecheck/CI, docker-compose dev (postgres, redis, api, worker, web, caddy).
2. Auth + aprovação por admin + painel admin mínimo (aprovar/bloquear usuário).
3. Projetos como repositórios (`git-store`): criar, listar, árvore de arquivos, criar/renomear/excluir arquivo e pasta, upload, importar zip/vários arquivos.
4. Editor CodeMirror + Yjs/Hocuspocus com persistência no working tree + autocommit.
5. Fila BullMQ + worker sandboxado + parser de log + PDF.js com status em tempo real.
6. Export: source zip e PDF.

**Fase 2 – Diferenciais**
7. Gerenciador de bibliotecas (manifesto, geração do `.tex`, painel, migração na importação).
8. Comentários de review com âncoras Yjs e papel `reviewer`.
9. Painel Git: histórico, diff, commit nomeado, restaurar versão.
10. Make a copy, word count, exports pandoc (DOCX/MD/HTML).

**Fase 3 – Endurecimento e extras**
11. Ajuste de rate limits, auditoria, backups automatizados, 2FA.
12. Remoto GitHub (push/pull), importar de URL git, download com histórico.
13. Track changes (sugestões), compartilhamento por link somente leitura.

---

## Execução com múltiplos agentes

### Papéis e modelos

| Papel | Modelo | O que faz |
|---|---|---|
| **Orquestrador** | Fable 5.1 (esta sessão) | Quebra cada fase em tarefas com brief escrito, despacha para o nível certo, roda os portões, corrige o que o revisor apontar, faz o commit de uma linha |
| **Implementador leve** | Haiku 4.5 | Tarefas mecânicas com spec fechada: DTOs e schemas zod, tabelas Drizzle a partir do modelo, Dockerfiles/compose/Caddyfile, seed do catálogo de pacotes, strings i18n, docs, testes unitários de funções puras |
| **Implementador** | Sonnet 5.5 | Módulos NestJS (service + controller + guard + testes), componentes e painéis React, processors BullMQ, wrapper isomorphic-git, integração Hocuspocus, runner do pandoc, testes e2e |
| **Implementador sênior** | Opus 5.5 (ou o próprio orquestrador) | Código sensível à segurança: `SandboxedProcess`/`LatexmkRunner`, importação de zip, `SafePath`, auth/sessão/CSRF, rate limit, CSP; conciliação Yjs x git (restore aplicado como diff) |
| **Revisor de código** | Opus 5.5 | Confere o diff contra o brief, o plano e as regras das skills instaladas (camadas, DI por token, composição de componentes). Nunca o mesmo agente que implementou |
| **Revisor de segurança/perf** | agente `code-reviewer-perf-security` | Roda em todo diff que toque auth, caminhos, upload, fila, sandbox, WebSocket ou SQL |

Regra de roteamento: se a tarefa cabe em um brief de meia página com interfaces já definidas, vai para Haiku; se exige decidir estrutura interna de um módulo, Sonnet; se um erro vira vulnerabilidade ou perda de dados, Opus. Em dúvida, sobe um nível. O orquestrador nunca aceita o relatório do implementador como prova: ele lê o diff.

Mecânica: `Agent` com `model` explícito (`haiku`/`sonnet`/`opus`). Tarefas independentes da mesma etapa rodam em paralelo com `isolation: "worktree"` (ex.: módulos `users`, `audit` e o seed do catálogo) e o orquestrador integra. Tarefas encadeadas rodam em sequência na árvore principal. Para etapas com 3 ou mais tarefas independentes, usar o `Workflow` com `pipeline(tarefas, implementar, revisar)` para que a revisão de uma comece enquanto outra ainda implementa, respeitando o limite de 10 agentes por workflow.

### Portões por tarefa (todos obrigatórios antes do commit)

1. **Build**: `pnpm lint && pnpm typecheck && pnpm test` no pacote tocado.
2. **Ponytail**: `/ponytail-review` sobre o diff. Tudo que for apontado como excesso (abstração sem segundo uso, dependência que a stdlib cobre, wrapper de uma linha) é removido, salvo se for fronteira de segurança, validação ou acessibilidade. Se o plugin não estiver instalado, o revisor aplica a escada de 7 degraus do ruleset copiado.
3. **Revisão de código** (Opus): aprova, ou devolve lista de correções ao mesmo implementador; no máximo 2 rodadas, depois o orquestrador assume.
4. **Revisão de segurança** quando a tarefa toca superfície sensível (lista acima).
5. **Commit** de uma linha pelo orquestrador.

### Portões por fase

- `/security-review` da branch inteira e `/ponytail-audit` do repositório.
- `pnpm audit --audit-level=high` e `gitleaks detect` (segredos) no repositório.
- Suíte de abuso do worker (itens 9 e 10 da seção Verificação) passando.
- Na Fase 3: `trivy image` nas imagens Docker; CodeQL e Dependabot já ativos no CI desde a Fase 1.

### Brief padrão de tarefa (o que cada agente recebe)

```
Objetivo: <uma frase>
Pacote/módulo: apps/api/src/modules/<x>
Interfaces já definidas: <ports/DTOs em packages/shared e domain/>
Arquivos a criar/alterar: <lista>
Critérios de aceite: <comportamento observável + testes que devem passar>
Regras: camadas presentation/application/domain/infrastructure; DI por token;
        sem shell string; caminhos só via SafePath; ponytail: mínimo que funciona
Skills a consultar: nestjs-best-practices | vercel-composition-patterns | ...
Não fazer: <escopo vizinho que outro agente está tocando>
```

---

## Verificação (fim a fim)

1. `docker compose up` sobe os 6 serviços; `docker stats` mostra uso total < 3 GB em repouso.
2. Cadastro → admin aprova → login → criar projeto → árvore vazia com `main.tex`.
3. Importar zip de uma tese de exemplo → commit "Import" aparece no histórico; migração de pacotes proposta.
4. Dois navegadores editando o mesmo arquivo veem as alterações um do outro; após 5 min existe commit "Autosave".
5. Compilar: status `queued → running → done`, PDF renderiza, clique no PDF leva à linha (SyncTeX).
6. Desligar `hyperref` no painel → recompilar → links somem; `latex-packages.tex` muda no diff.
7. Comentar um trecho, outro usuário editar acima → âncora continua no lugar.
8. Exportar os 5 formatos; o zip compila localmente com `latexmk`.
9. **Testes de abuso** (devem falhar com segurança): zip com `../../etc/passwd`; zip com `.git/hooks/post-checkout`; `.tex` com `\write18{id}`; `.tex` com `\loop` infinito (timeout 180 s); `.tex` que grava em `../fora.txt`; 20 pedidos de compile em 10 s (rate limit); 5 jobs do mesmo projeto (dedupe).
10. Restaurar uma versão antiga enquanto outro usuário edita → sem perda de edição, comentários mantidos.
