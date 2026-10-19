// `pnpm lan`: runs latex-studio on this machine with LAN share on, so friends on the same network
// edit a published project with a PIN. It sets up everything it can (.env, Postgres/Redis, the
// shared packages) and leaves only the firewall to you. README: "Compartilhar um projeto na rede
// local (LAN)".
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_APP_URL = 'http://localhost:5173';

/**
 * Sets each KEY=value in a .env text: rewrites every line of that key (the loader keeps the last
 * duplicate), or appends one.
 */
export function setEnv(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, 'gm');
    out =
      out.search(line) >= 0
        ? out.replace(line, () => `${key}=${value}`)
        : `${out.replace(/\n?$/, '\n')}${key}=${value}\n`;
  }
  return out;
}

/**
 * A dev .env from .env.example: services on localhost, data/ folders here. LAN share itself stays
 * out of the file (lanOverrides passes it to `pnpm lan` only), so a plain `pnpm dev` stays local.
 */
export function freshEnv(example, root) {
  const e = parseEnv(example);
  // Quoted: an unquoted value is cut at " #", which a folder name may contain.
  const dir = (name) => `"${join(root, 'data', name).replaceAll('\\', '/')}"`;
  return setEnv(example, {
    APP_URL: DEFAULT_APP_URL,
    DATABASE_URL: `postgres://${e.POSTGRES_USER}:${e.POSTGRES_PASSWORD}@localhost:5432/${e.POSTGRES_DB}`,
    REDIS_URL: `redis://:${e.REDIS_PASSWORD}@localhost:6379`,
    REPOS_DIR: dir('repos'),
    BUILDS_DIR: dir('builds'),
  });
}

/**
 * What LAN mode needs on top of the .env, given to the processes only so the file keeps any
 * FasorX/server values: local mode (no verifier), LAN share on, and an http://localhost:<port>
 * APP_URL, whose port the friends' link reuses.
 */
export function lanOverrides(env) {
  let appUrl = DEFAULT_APP_URL;
  try {
    const u = new URL(env.APP_URL ?? '');
    if (u.protocol === 'http:' && u.hostname === 'localhost' && u.port) appUrl = u.origin;
  } catch {}
  return {
    NODE_ENV: 'development',
    LAN_SHARE: 'true',
    APP_URL: appUrl,
    AUTH_JWKS_URL: '',
    AUTH_SECRET: '',
    VITE_FASORX_URL: '',
  };
}

function fail(message) {
  console.error(`\n\x1b[31m✖ ${message}\x1b[0m\n`);
  process.exit(1);
}

/** pnpm as the command that launched this script: a JS entry runs under this node, else directly. */
function pnpm(args) {
  const entry = process.env.npm_execpath ?? '';
  return /\.[cm]?js$/.test(entry) ? [process.execPath, [entry, ...args]] : [entry, args];
}

function run(label, [cmd, args], hint, env = {}) {
  console.log(`\x1b[36m→ ${label}\x1b[0m`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) fail(`${label} falhou.${hint ? ` ${hint}` : ''}`);
}

/**
 * True when something already answers on `port` here. A trial listen on 0.0.0.0 would miss it: on
 * Windows it coexists with a server on 127.0.0.1, ::1 or ::, so an old `pnpm dev` would get the
 * host's browser while the banner claimed LAN share was up.
 */
const portUsed = (port) =>
  new Promise((ok) => {
    const c = connect(port, 'localhost')
      .once('connect', () => {
        c.destroy();
        ok(true);
      })
      .once('error', () => ok(false));
  });

async function waitFor(url, ms) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  // Before touching anything: children are started through this same pnpm.
  if (!/pnpm/i.test(process.env.npm_execpath ?? '')) fail('Rode pelo pnpm: pnpm lan');
  if (process.env.NODE_ENV === 'production')
    fail('pnpm lan é para rodar localmente, não em produção.');
  const need = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines.node;
  const [a, b, c] = need.replace(/^>=/, '').split('.').map(Number);
  const [x, y, z] = process.versions.node.split('.').map(Number);
  if (x < a || (x === a && (y < b || (y === b && z < c)))) {
    fail(
      `Node ${process.versions.node} é antigo: instale o Node ${need.replace('>=', '')} ou mais novo.`,
    );
  }

  // .env: created on a fresh clone; on an existing one only a missing LAN_SECRET is written.
  const envPath = join(ROOT, '.env');
  const secret = () => randomBytes(32).toString('hex');
  if (!existsSync(envPath)) {
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
    // It holds passwords and the LAN secret: owner-only on POSIX (ignored on Windows).
    writeFileSync(envPath, freshEnv(example, ROOT), { mode: 0o600 });
    console.log('\x1b[36m→ .env criado para rodar nesta máquina\x1b[0m');
  }
  let text = readFileSync(envPath, 'utf8');
  if ((parseEnv(text).LAN_SECRET ?? '').length < 32) {
    text = setEnv(text, { LAN_SECRET: secret() });
    writeFileSync(envPath, text);
    console.log('\x1b[36m→ LAN_SECRET gerado no .env\x1b[0m');
  }
  const file = parseEnv(text);
  const env = lanOverrides(file);
  if (file.AUTH_JWKS_URL || file.AUTH_SECRET || file.VITE_FASORX_URL) {
    console.log(
      '\x1b[33m! O .env tem FasorX (AUTH_*/VITE_FASORX_URL): ignorado no modo LAN.\x1b[0m',
    );
  }
  // The shell's API_PORT wins inside the API (the .env never overrides it), so Vite must use it too.
  const apiPort = Number(process.env.API_PORT || file.API_PORT || 3000);
  const webPort = Number(new URL(env.APP_URL).port);
  for (const port of [apiPort, webPort]) {
    if (await portUsed(port)) {
      fail(
        `A porta ${port} está em uso por outro programa (talvez outra cópia do app). Encerre-o e tente de novo.`,
      );
    }
  }

  if (!existsSync(join(ROOT, 'node_modules'))) {
    run('Instalando dependências', pnpm(['install', '--frozen-lockfile']));
  }
  run(
    'Subindo Postgres e Redis',
    ['docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait']],
    'O Docker está instalado e aberto?',
  );
  run('Compilando os pacotes compartilhados', pnpm(['--filter', './packages/*', 'build']));
  // A production build served by `vite preview` (same proxy): no dev-server endpoints on the LAN,
  // and one bundle instead of hundreds of modules for the friends' browsers.
  run(
    'Gerando o frontend',
    pnpm(['--filter', '@latex-studio/web', 'exec', 'vite', 'build']),
    '',
    env,
  );

  const children = [];
  let stopping = false;
  const stopAll = (code) => {
    stopping = true;
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      // Kill the whole tree: pnpm, then nest/vite under it, which would else keep the ports.
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {}
      }
    }
    process.exit(code);
  };
  // Windows: Ctrl+C already reached every child through the shared console, and the API is saving
  // the open documents' pending edits; a force-kill now would lose them. Let them exit, and kill
  // only what is still up after a while (the script ends by itself once they are gone).
  process.on('SIGINT', () => {
    if (process.platform !== 'win32') return stopAll(0);
    stopping = true;
    setTimeout(() => stopAll(0), 15_000).unref();
  });
  process.on('SIGTERM', () => stopAll(0));
  // POSIX: the children are in their own session, so closing the terminal would orphan them.
  process.on('SIGHUP', () => stopAll(0));

  const start = (name, color, args, extra = {}) => {
    const [cmd, argv] = pnpm(args);
    const child = spawn(cmd, argv, {
      cwd: ROOT,
      env: { ...process.env, ...env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so stopAll can end the tree (Windows uses taskkill /T instead).
      detached: process.platform !== 'win32',
    });
    const tag = `\x1b[${color}m[${name}]\x1b[0m `;
    for (const stream of [child.stdout, child.stderr]) {
      let rest = '';
      stream.setEncoding('utf8'); // a multi-byte character may straddle two chunks
      stream.on('data', (chunk) => {
        const lines = (rest + chunk).split(/\r?\n/);
        rest = lines.pop() ?? '';
        for (const line of lines) {
          // tsc and Nest clear the screen as they build, which would wipe the others' logs.
          const clean = line
            .replaceAll('\x1b[2J', '')
            .replaceAll('\x1b[3J', '')
            .replaceAll('\x1b[H', '');
          if (clean.trim()) process.stdout.write(`${tag}${clean}\n`);
        }
      });
    }
    child.on('exit', (code) => {
      if (stopping) return;
      console.error(`${tag}parou (código ${code}). Encerrando tudo.`);
      stopAll(1);
    });
    children.push(child);
  };

  // `nest start`, not the watch-mode `dev`: watch mode outlives a crash, which then went unnoticed.
  start('api', 34, ['--filter', '@latex-studio/api', 'exec', 'nest', 'start']);
  start('worker', 35, ['--filter', '@latex-studio/worker', 'exec', 'nest', 'start']);
  start(
    'web',
    32,
    [
      '--filter',
      '@latex-studio/web',
      'exec',
      'vite',
      'preview',
      '--host',
      '0.0.0.0',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    { API_PORT: String(apiPort) },
  );

  const up =
    (await waitFor(`http://127.0.0.1:${apiPort}/api/health`, 180_000)) &&
    (await waitFor(`http://127.0.0.1:${webPort}/`, 60_000));
  if (!up) {
    console.error('\x1b[31m✖ A API ou o frontend não responderam. Veja os logs acima.\x1b[0m');
    stopAll(1);
  }

  const lan = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? [])
      .filter((ni) => ni.family === 'IPv4' && !ni.internal)
      .map((ni) => `http://${ni.address}:${webPort}  (${name})`),
  );
  console.log(`
\x1b[32m✔ LaTeX Studio no ar, com compartilhamento em rede local.\x1b[0m

  Você (anfitrião), neste computador:  ${env.APP_URL}
  Endereços na rede:  ${lan.join('\n                      ') || '(nenhum: este computador não está numa rede)'}

  Para compartilhar:
  1. Na tela inicial, ligue "Acesso remoto (LAN)" (começa desligado a cada início).
  2. No projeto: Compartilhar → Publicar na rede → adicione cada pessoa e anote o PIN.
  3. Mande o link e o PIN.

  \x1b[33mFalta só o firewall:\x1b[0m libere a porta ${webPort} para a rede privada
  (Windows: aceite o aviso do Node marcando "Redes privadas"; Linux: sudo ufw allow ${webPort}/tcp).

  Ctrl+C encerra o app. Postgres e Redis seguem no Docker
  (para parar: docker compose -f docker-compose.dev.yml stop).
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
