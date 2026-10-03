import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import {
  ForbiddenException,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import type { User } from '../../users/domain/user';
import { USER_REPOSITORY, type UserRepository } from '../../users/domain/user.repository';
import { PASSWORD_HASHER, type PasswordHasher } from '../domain/password-hasher';
import { SESSION_REPOSITORY, type SessionRepository } from '../domain/session.repository';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INVALID_CREDENTIALS = 'Invalid email or password';

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');
const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  /** Verified against for unknown emails, so they cost the same as a wrong password. */
  private readonly dummyHash: Promise<string>;

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.dummyHash = hasher.hash(randomBytes(32).toString('hex'));
  }

  /** Seeds the first admin, then sweeps expired sessions. */
  async onApplicationBootstrap() {
    if ((await this.users.countAdmins()) === 0) {
      const admin = await this.users.create({
        email: normalizeEmail(this.config.ADMIN_EMAIL),
        name: 'Admin',
        passwordHash: await this.hasher.hash(this.config.ADMIN_PASSWORD),
        role: 'admin',
        status: 'active',
      });
      // Never promote an existing account: whoever registered that email does not own ADMIN_PASSWORD.
      if (!admin) throw new Error('ADMIN_EMAIL is already registered by a non-admin user');
    }
    // ponytail: only swept on boot; add a daily sweep when the scheduler/queue lands.
    await this.sessions.deleteExpired();
  }

  /** Same outcome whether or not the email exists, so registration is not an email oracle. */
  async register(email: string, name: string, password: string): Promise<void> {
    const passwordHash = await this.hasher.hash(password);
    await this.users.create({ email: normalizeEmail(email), name, passwordHash });
  }

  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    // No per-account lockout (anyone could lock the admin out): brute force is bounded by the
    // 5/min/IP rate limit and the argon2 cost.
    const user = await this.users.findByEmail(normalizeEmail(email));
    const valid = await this.hasher.verify(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user || !valid) throw new UnauthorizedException(INVALID_CREDENTIALS);
    if (user.status !== 'active') throw new ForbiddenException(`Account is ${user.status}`);

    const token = randomBytes(32).toString('base64url');
    await this.sessions.create({
      tokenHash: sha256(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    const { passwordHash: _, ...publicUser } = user;
    return { token, user: publicUser };
  }

  logout(token: string) {
    return this.sessions.deleteByTokenHash(sha256(token));
  }

  /** User behind a valid, unexpired session (any status), or null. */
  async resolveSession(token: string): Promise<User | null> {
    const session = await this.sessions.findByTokenHash(sha256(token));
    if (!session || session.expiresAt <= new Date()) return null;
    return this.users.findById(session.userId);
  }
}
