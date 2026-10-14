# Arquitetura do latex-studio

Editor LaTeX colaborativo com três premissas:

1. **Cada projeto é um repositório Git** (histórico, diff, restaurar versão, commits nomeados).
2. **Gerenciador de bibliotecas**: pacotes LaTeX ligados/desligados por um painel, sem comentar `\usepackage`.
3. **Fila de compilação isolada** com limites de recurso, pensada para um servidor pequeno (2 vCPU / 4 GB RAM) hospedado com Docker.

Além disso: edição simultânea (CRDT), comentários de review, importação (zip ou vários arquivos) e exportação (fonte zip, PDF, DOCX, Markdown, HTML).

Convenções de código e fluxo de trabalho estão em `CLAUDE.md`.

---

## Stack

| Camada | Escolha |
|---|---|
| Linguagem | TypeScript em tudo (monorepo pnpm) |
| API + WebSocket | NestJS (adaptador Fastify) + Hocuspocus (Yjs) no mesmo processo |
| Fila | BullMQ sobre Redis |
| Worker | App NestJS standalone, numa imagem com TeX Live + pandoc; sem `docker.sock` |
| Banco | PostgreSQL 16 (Drizzle) |
| Git | `isomorphic-git` (JS puro, nunca executa `git` nem hooks) |
| Frontend | React + Vite, CodeMirror 6 + `y-codemirror.next`, PDF.js |
| Proxy | Caddy (serve o build estático da web e faz proxy da API) |

Limites de memória em `docker-compose.yml`: Postgres 384 MB, Redis 96 MB, API 512 MB, worker 1,5 GB. A fila absorve picos: quem pede compilação espera, em vez de derrubar o servidor.

## Layout do repositório

```
apps/
  web/      React + Vite (editor, PDF, painéis)
  api/      NestJS (Fastify) + Hocuspocus + REST; enfileira jobs
  worker/   NestJS standalone: consome as filas (compile, export, wordcount, format)
packages/
  core/         Módulos NestJS usados por api e worker (config, database, queue, storage)
  latex-tools/  Classes puras: parser de log, parser de \usepackage, manifesto de pacotes
  git-store/    Classe sobre isomorphic-git: commit, log, diff, blame
docker/         api, web, texlive (imagem do worker), postgres
docker-compose.yml, docker-compose.dev.yml, Caddyfile, .env.example
.github/workflows/  CI (lint, typecheck, test, imagens + Trivy, gitleaks) e CodeQL
```

Dados persistentes (volumes): working tree + `.git` de cada projeto, builds (PDF, log, synctex), Postgres e os certificados do Caddy. O Redis é efêmero (sem volume, `--save ""`).

## Camadas

### Backend
Cada domínio é um módulo NestJS em `apps/api/src/modules/<dominio>/` com `presentation/` (controllers, DTOs, guards), `application/` (services, casos de uso), `domain/` (entidades e ports) e `infrastructure/` (adapters). Dependências apontam para dentro; a injeção é por token de interface (`@Inject(PROJECT_REPOSITORY)`), para que testes troquem o adapter por um fake.

Guards: `IdentityGuard` (verifica o JWT) e `ProjectRoleGuard` (papel no projeto). O worker reutiliza `packages/core` e delega cada fila a um processor (compile, tools).

### Frontend
Serviços são classes simples resolvidas por `useService(Token)` via `ServiceProvider`. TanStack Query para dados do servidor, Zustand só para estado de UI, Yjs para o texto. Componentes seguem `vercel-composition-patterns`.

## Modelo de dados

Esquema Drizzle em `packages/core/src/database/schema`: usuários, projetos e membros, estado Yjs por arquivo, comentários, builds, `file_edits` (quem editou o quê desde o último commit) e log de auditoria. O conteúdo dos arquivos **não** fica no banco: o working tree Git no disco é a fonte da verdade e o Yjs é a camada "ao vivo" sobre ele.

## Fluxos principais

### Edição simultânea + Git
- Um `Y.Doc` por arquivo de texto; Hocuspocus multiplexa vários em um WebSocket.
- `onAuthenticate` valida o token (enviado pelo provider), a `Origin` e o papel no projeto (viewer = somente leitura). Upgrades de WebSocket não passam pelos guards do Nest.
- `onStoreDocument` (debounce) grava o estado no banco e escreve o arquivo no working tree (autosave). Autosave nunca commita.
- **Commit só quando o usuário pede** (Ctrl+S ou "Salvar versão"). Co-autores = quem mais editou aqueles arquivos desde o último commit (`file_edits`).
- **Histórico**: log, diff entre commits, blame e restaurar arquivo/versão. O restore é aplicado ao `Y.Doc` como diff, para manter âncoras de comentários e não desconectar quem edita.
- Binários (imagens, PDFs) não passam pelo Yjs: upload direto para o disco.

### Gerenciador de bibliotecas
- `latex-packages.json` versionado na raiz do projeto: `[{ name, options, enabled, order }]`.
- A API regenera `latex-packages.tex` a cada alteração: os habilitados na ordem (pulando os que o código já carrega) e, para os desligados, linhas `\def ver@<pacote>.sty` que tornam qualquer `\usepackage` posterior um no-op; o `main.tex` inclui `\input{latex-packages}` após `\documentclass`. O zip exportado compila em qualquer lugar sem a plataforma.
- Na importação, `latex-tools` detecta `\usepackage` no preâmbulo e oferece migrar para o gerenciador.

### Comentários
Âncoras por `Y.RelativePosition` (sobrevivem a edições alheias), com fallback por commit + trecho citado. Papel `reviewer` só lê e comenta. Os comentários trafegam por REST (TanStack Query).

### Fila de compilação
- `POST /projects/:id/compile` recusa (409) se o projeto já tem uma compilação ativa, limita as pendentes por usuário e tem rate limit de 10/min.
- O worker copia um snapshot do working tree e roda `latexmk -no-shell-escape` sem shell, com timeout, num grupo de processos que é morto por inteiro.
- Container do worker (ver `docker-compose.yml`): rede `internal` sem saída para a internet (mas com Postgres e Redis), `read_only`, `tmpfs /tmp`, `init`, `cap_drop: ALL`, `no-new-privileges`, `pids_limit`, `mem_limit`. Limitação conhecida: o TeX roda com o mesmo uid do worker; execução de código no TeX alcançaria Redis/Postgres.
- Saída: PDF + log + synctex; o log é parseado em erros/avisos por `latex-tools`; o cliente consulta o status a cada 1,5 s enquanto há build ativo.
- A fila `tools` atende `export` (pandoc), `wordcount` (texcount) e `format` (latexindent).

### Importação e exportação
- Zip: proteção contra zip-slip, limites de entradas e de tamanho descomprimido, descarte de qualquer entrada `.git/`.
- Exportação: fonte zip (opcionalmente com o `.git`), PDF do último build, DOCX/Markdown/HTML via pandoc no worker, cópia de projeto e contagem de palavras.

## Segurança

- **Identidade**: sem login próprio. A aplicação da frente (FasorX) assina um JWT curto, enviado em `Authorization: Bearer`; a API fixa o algoritmo, confere `iss`/`aud`/`exp` e um teto de validade, e cria o usuário na primeira visita. O token fica só em memória no navegador, nunca em URL. Sem verificador configurado, modo local, aceito só com `APP_URL` em localhost e fora de `NODE_ENV=production`; nesse modo a API escuta só em loopback.
- **Rate limit** (`@fastify/rate-limit`): 300/min por IP como base, mais limites por rota (compile, upload, importação).
- **Autorização** por papel em toda rota de projeto.
- **Caminhos**: todo caminho vindo do usuário passa por `SafePath` (rejeita `..`, absolutos e symlinks; `realpath` dentro do diretório do projeto).
- **Processos**: nenhum shell string; `execFile`/`spawn` com array de argumentos, só dentro do sandbox do worker.
- **HTTP**: `@fastify/helmet` com CSP.
- **Operação**: segredos só por env (`.env` fora do repo, `.env.example` no repo), `SECURITY.md`, Dependabot, CodeQL, Trivy e gitleaks no CI.
