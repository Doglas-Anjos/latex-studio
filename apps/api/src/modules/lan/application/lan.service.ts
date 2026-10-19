import { randomUUID } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY, type UserRepository } from '../../users/domain/user.repository';
import { LAN_REPOSITORY, type LanRepository } from '../domain/lan.repository';
import { LanTokenService } from './lan-token.service';
import { generatePin, hashPin, isPin, verifyPin } from './pin';

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
 * No HTTP surface yet (phase 1) — verification, hashing and the brute-force lockout live here so
 * the guard/controller added later just call `verify`.
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
    const token = await this.tokens.sign(access.userId);
    return token ? { token, alias: access.alias } : null;
  }

  publish(projectId: string): Promise<void> {
    return this.repo.publish(projectId);
  }
  unpublish(projectId: string): Promise<void> {
    return this.repo.unpublish(projectId);
  }
  isPublished(projectId: string): Promise<boolean> {
    return this.repo.isPublished(projectId);
  }
  listPublished(): Promise<string[]> {
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
    const clean = alias.trim();
    if (clean.length < 1 || clean.length > 40 || /\p{Cc}/u.test(clean)) {
      throw new BadRequestException('Invalid alias');
    }
    const sub = randomUUID();
    const user = await this.users.upsert({
      issuer: 'lan',
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
   * published, else null. The guard (phase 3) consults this after a normal membership check.
   * Argument order mirrors `ProjectRepository.roleOf(projectId, userId)` so the two can't be swapped.
   */
  async roleOf(projectId: string, userId: string): Promise<'editor' | null> {
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

  revokeAccess(id: string): Promise<void> {
    return this.repo.deleteAccess(id);
  }

  /**
   * The access a PIN unlocks for a published project, or null when the PIN is wrong (or the project
   * is not published). Throws 429 once `clientKey` has failed too many times, so the 10k PIN space
   * cannot be walked. `clientKey` is the caller's address, set by the guard.
   */
  async verify(
    projectId: string,
    pin: string,
    clientKey: string,
  ): Promise<{ id: string; userId: string; alias: string } | null> {
    if (!isPin(pin)) return null;
    const now = Date.now();
    const client: [string, number] = [`c:${projectId}:${clientKey}`, CLIENT_FAILS];
    const project: [string, number] = [`p:${projectId}`, PROJECT_FAILS];
    if (this.lockedUntil(...client) > now || this.lockedUntil(...project) > now) {
      throw new HttpException(
        'Too many PIN attempts, try again soon',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!(await this.repo.isPublished(projectId))) return null;
    for (const row of await this.repo.accessesOf(projectId)) {
      if (await verifyPin(pin, row.pinHash)) {
        this.attempts.delete(client[0]);
        this.attempts.delete(project[0]);
        await this.repo.touchAccess(row.id);
        return { id: row.id, userId: row.userId, alias: row.alias };
      }
    }
    this.prune(now);
    this.record(client[0], now);
    this.record(project[0], now);
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
