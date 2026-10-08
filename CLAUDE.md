# latex-studio

Collaborative LaTeX editor (Overleaf-like) where every project is a git repository,
LaTeX packages are toggled from a manifest, and compilation runs in a sandboxed queue.
Full architecture plan: see `docs/architecture.md`.

## Stack
- pnpm monorepo, TypeScript strict everywhere.
- `apps/api`: NestJS on the Fastify adapter + Hocuspocus (Yjs) in the same process.
- `apps/worker`: NestJS standalone app consuming BullMQ (compile, export, wordcount, format).
- `apps/web`: React + Vite, CodeMirror 6 + y-codemirror.next, PDF.js.
- `packages/core`: NestJS modules shared by api and worker (config, database, queue, storage).
- `packages/shared`: DTOs and zod schemas shared across api, worker and web.
- `packages/latex-tools`, `packages/git-store`: pure classes, no framework imports.
- Postgres 16 via Drizzle, Redis 7, isomorphic-git (never spawn `git`).

## Architecture rules (enforced in review)
- Every backend domain is a NestJS module with `presentation/`, `application/`, `domain/`, `infrastructure/`.
  Dependencies point inward. Services never import HTTP or filesystem code directly.
- Inject by interface token (`@Inject(PROJECT_REPOSITORY)`), never by concrete class, so tests can swap fakes.
- Frontend: services are plain classes resolved through `useService(Token)` from the `ServiceProvider` context.
  TanStack Query for server state, Zustand only for UI state, Yjs for document text.
- Components follow `vercel-composition-patterns` (compound components, slots, no prop drilling).

## Security rules (non-negotiable)
- No shell strings. Child processes only via `execFile`/spawn with argument arrays, and only inside the worker sandbox.
- Every filesystem path from a user goes through `SafePath` (rejects `..`, absolute paths, symlinks; realpath inside the project dir).
- Zip import: zip-slip check, entry/size caps, drop any `.git/` entry.
- Compile: `latexmk -no-shell-escape`, timeout, memory and pid limits; no internet egress, but TeX runs as the worker uid on the internal network (reaches Postgres/Redis).
- No login of its own: the application in front (FasorX) signs a short JWT; `IdentityGuard` verifies it (`jose`, algorithm pinned by config, `iss`/`aud`, max lifetime) and a `ProjectRoleGuard` checks the role. Rate limits on compile and upload.
- Local mode (no verifier) is only accepted when `APP_URL` is localhost; the config schema enforces it.
- WebSocket upgrades bypass Nest guards: the Hocuspocus `onAuthenticate` hook must verify the bearer token (provider `token`) and the `Origin` header itself.
- Downloads go through fetch with the bearer header; never put the token in a URL.
- Secrets only via env; `.env` is gitignored; `.env.example` lists every variable.

## Code style
- Lazy senior dev mode: `.claude/rules/ponytail.md` applies. Minimum code that works; no speculative abstractions.
- Commits: one line, Conventional Commits, English, imperative, <= 72 chars. No body.
  Examples: `feat(api): add compile queue with per-project dedupe`, `fix(web): keep comment anchors after restore`.
- Lint/format: Biome. Tests: Vitest (packages, web) and Jest via `@nestjs/testing` (api, worker).

## Agent workflow
- Orchestrator writes a task brief, routes by risk: Haiku for mechanical specs, Sonnet for modules and components,
  Opus for security-sensitive code and for every code review. Reviewer is never the implementer.
- Gates before each commit: `pnpm lint && pnpm typecheck && pnpm test`, `/ponytail-review` on the diff,
  code review, security review when auth/paths/upload/queue/sandbox/websocket/SQL are touched.
- Skills in `.claude/skills/`: `nestjs-best-practices`, `vercel-react-best-practices`,
  `vercel-composition-patterns`, `frontend-design`, `ponytail-review`.
