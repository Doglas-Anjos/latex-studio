import { randomUUID } from 'node:crypto';
import type { NetworkInterfaceInfo } from 'node:os';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LAN_ISSUER } from '../../users/domain/user';
import { USER_REPOSITORY, type UserRepository } from '../../users/domain/user.repository';
import { LAN_REPOSITORY, type LanRepository } from '../domain/lan.repository';
import { LanTokenService } from './lan-token.service';
import { generatePin, hashPin, isPin, verifyPin } from './pin';

/**
 * The app's origin rebased onto each non-internal IPv4 of the host, so the owner (who may have
 * opened the app on localhost) gets a link a friend on the LAN can actually reach. Pure: the caller
 * passes `os.networkInterfaces()`. Empty when the host has no LAN address or APP_URL is unparseable.
 */
export function lanOrigins(appUrl: string, nets: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  let origin: { protocol: string; port: string };
  try {
    const u = new URL(appUrl);
    origin = { protocol: u.protocol, port: u.port };
  } catch {
    return [];
  }
  const urls: string[] = [];
  for (const list of Object.values(nets)) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        urls.push(`${origin.protocol}//${ni.address}${origin.port ? `:${origin.port}` : ''}`);
      }
    }
  }
  return urls;
}

/** A person's access as shown to the host (never the PIN hash). */
export interface LanAccessView {
  id: string;
  projectId: string;
  alias: string;
  createdAt: Date;
  lastSeen: Date | null;
}

// Wrong-PIN budget before a key locks: a small one per client (quick feedback), a larger one per
// project so rotating/spoofing the source address still trips a project-wide cap — the only thing
// that makes a 4-digit PIN safe against a determined LAN peer.
const CLIENT_FAILS = 5;
const PROJECT_FAILS = 30;
const BASE_LOCK_MS = 60_000;
const MAX_LOCK_MS = 15 * 60_000;
// A counter is forgotten after this long with no new failure (so honest fumbling heals).
const MEMORY_MS = 60 * 60_000;

/**
 * LAN share: publish a project to the local network and hand each friend an alias + a 4-digit PIN.
 * PIN verification, hashing and the brute-force lockout live here; LanController exposes them over
 * HTTP, and ProjectRoleGuard/CollabService consult `roleOf` for a guest's editor role. The reads on
 * every request (`roleOf`, `listPublished`, `projectsFor`) answer empty when LAN share is off, so
 * production never queries the LAN tables for them.
 */
@Injectable()
export class LanService {
  // ponytail: in-memory lockout, resets on restart and is per-process (the API is one process). A
  // `lan_pin_attempts` table if it ever runs clustered. Keyed per client and per project.
  private readonly attempts = new Map<string, { failed: number; last: number }>();

  constructor(
    @Inject(LAN_REPOSITORY) private readonly repo: LanRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(LanTokenService) private readonly tokens: LanTokenService,
  ) {}

  /**
   * A friend joins with a PIN: verify it, then mint a session token carrying the backing user id.
   * Null when the PIN is wrong or the project is not published; throws 429 when locked out.
   */
  async join(
    projectId: string,
    pin: string,
    clientKey: string,
  ): Promise<{ token: string; alias: string } | null> {
    // When LAN share is off, bail before verify so a disabled feature never burns a PIN attempt.
    if (!this.tokens.enabled) return null;
    const access = await this.verify(projectId, pin, clientKey);
    if (!access) return null;
    // Non-null: sign returns null only when disabled, checked above.
    return { token: (await this.tokens.sign(access.userId)) as string, alias: access.alias };
  }

  /** Whether LAN share is configured (flag + secret); the UI greys the controls out when false. */
  enabled(): boolean {
    return this.tokens.enabled;
  }

  publish(projectId: string): Promise<void> {
    // Off everywhere but a local LAN install, so these never create rows in production (where the
    // routes still exist but LAN is disabled): a NotFound makes the feature invisible there.
    if (!this.tokens.enabled) throw new NotFoundException();
    return this.repo.publish(projectId);
  }
  unpublish(projectId: string): Promise<void> {
    return this.repo.unpublish(projectId);
  }
  isPublished(projectId: string): Promise<boolean> {
    return this.repo.isPublished(projectId);
  }
  /** Read on every project listing: empty, without a query, when LAN share is off. */
  async listPublished(): Promise<string[]> {
    if (!this.tokens.enabled) return [];
    return this.repo.listPublished();
  }

  /**
   * Creates a person's access and returns the one-time plaintext PIN for the host to share. Each
   * access is backed by a real user row (name = alias) so presence, blame and history credit it.
   */
  async createAccess(
    projectId: string,
    alias: string,
  ): Promise<{ id: string; alias: string; pin: string }> {
    if (!this.tokens.enabled) throw new NotFoundException();
    const clean = alias.trim();
    if (clean.length < 1 || clean.length > 40 || /\p{Cc}/u.test(clean)) {
      throw new BadRequestException('Invalid alias');
    }
    const sub = randomUUID();
    const user = await this.users.upsert({
      issuer: LAN_ISSUER,
      subject: sub,
      email: `lan+${sub}@localhost`,
      name: clean,
    });
    const pin = generatePin();
    const { id } = await this.repo.createAccess(projectId, user.id, clean, await hashPin(pin));
    return { id, alias: clean, pin };
  }

  /**
   * The role a LAN user has on a project: `editor` when they hold an access and the project is still
   * published, else null (always null when LAN share is off). ProjectRoleGuard and CollabService
   * consult this after a normal membership check. Argument order mirrors
   * `ProjectRepository.roleOf(projectId, userId)` so the two can't be swapped.
   */
  async roleOf(projectId: string, userId: string): Promise<'editor' | null> {
    if (!this.tokens.enabled) return null;
    if (
      (await this.repo.hasAccess(projectId, userId)) &&
      (await this.repo.isPublished(projectId))
    ) {
      return 'editor';
    }
    return null;
  }

  async listAccess(projectId: string): Promise<LanAccessView[]> {
    const rows = await this.repo.accessesOf(projectId);
    // Drop the PIN hash and the internal backing user id.
    return rows.map(({ pinHash: _pinHash, userId: _userId, ...rest }) => rest);
  }

  /** Deletes an access and returns the backing user id, so the caller can close its open sockets. */
  async revokeAccess(projectId: string, id: string): Promise<string | null> {
    const row = (await this.repo.accessesOf(projectId)).find((a) => a.id === id);
    if (!row) return null;
    await this.repo.deleteAccess(projectId, id);
    return row.userId;
  }

  /** Every access's backing user id, so unpublish can close those peers' open sockets. */
  async accessUserIds(projectId: string): Promise<string[]> {
    return (await this.repo.accessesOf(projectId)).map((a) => a.userId);
  }

  /**
   * The published projects a LAN user may edit, so a guest's dashboard shows what was shared with
   * them. ponytail: scans the published set (few, local-only); a `lan_access` lookup by user id if
   * that ever grows.
   */
  async projectsFor(userId: string): Promise<string[]> {
    const published = await this.listPublished();
    const mine = await Promise.all(
      published.map(async (id) => ((await this.repo.hasAccess(id, userId)) ? id : null)),
    );
    return mine.filter((id): id is string => id !== null);
  }

  /**
   * The access a PIN unlocks for a published project, or null when the PIN is wrong (or the project
   * is not published). Throws 429 once `clientKey` has failed too many times, so the 10k PIN space
   * cannot be walked. `clientKey` is the caller's address (LanController passes Fastify's req.ip).
   */
  async verify(
    projectId: string,
    pin: string,
    clientKey: string,
  ): Promise<{ id: string; userId: string; alias: string } | null> {
    if (!isPin(pin)) return null;
    const now = Date.now();
    // Postgres matches a uuid in any case, so key the counters on the lowercase id: else each case
    // variant of the same project id would get a fresh failure budget.
    const key = projectId.toLowerCase();
    const client: [string, number] = [`c:${key}:${clientKey}`, CLIENT_FAILS];
    const project: [string, number] = [`p:${key}`, PROJECT_FAILS];
    if (this.lockedUntil(...client) > now || this.lockedUntil(...project) > now) {
      throw new HttpException(
        'Too many PIN attempts, try again soon',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Count the attempt as failed before the first await, and undo it on success: else a burst of
    // concurrent guesses all pass the lock check above before any of them is recorded.
    this.prune(now);
    this.record(client[0], now);
    this.record(project[0], now);
    if (!(await this.repo.isPublished(projectId))) return null;
    for (const row of await this.repo.accessesOf(projectId)) {
      if (await verifyPin(pin, row.pinHash)) {
        // Clear this client's counter; take back only this attempt from the project-wide one: a
        // friend who holds one PIN must not be able to reset the whole project's failure budget by
        // logging in between runs and so walk the 10k PIN space to impersonate other friends.
        // ponytail: still heals after MEMORY_MS idle (~30 guesses/h/project); rotating/expiring PINs
        // is the real cap, add it if guests stay invited long enough for that to add up.
        this.attempts.delete(client[0]);
        const p = this.attempts.get(project[0]);
        if (p) p.failed--;
        await this.repo.touchAccess(row.id);
        return { id: row.id, userId: row.userId, alias: row.alias };
      }
    }
    return null;
  }

  /** When a key is locked until, or 0 if not: an escalating backoff once past `threshold` fails. */
  private lockedUntil(key: string, threshold: number): number {
    const a = this.attempts.get(key);
    if (!a || a.failed < threshold) return 0;
    return a.last + Math.min(BASE_LOCK_MS * 2 ** (a.failed - threshold), MAX_LOCK_MS);
  }

  private record(key: string, now: number): void {
    const prev = this.attempts.get(key);
    // Keep counting (so the backoff escalates) until a whole MEMORY_MS passes with no failure.
    const failed = (prev && now - prev.last < MEMORY_MS ? prev.failed : 0) + 1;
    this.attempts.set(key, { failed, last: now });
  }

  /** Drops counters idle past MEMORY_MS; never touches live locks (unlike a blanket clear). */
  private prune(now: number): void {
    if (this.attempts.size <= 10_000) return;
    for (const [k, a] of this.attempts) if (now - a.last > MEMORY_MS) this.attempts.delete(k);
  }
}
