import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuthService } from '../../application/auth.service';
import { isPublic } from '../decorators';

export const SESSION_COOKIE = 'sid';

/** Token from the signed `sid` cookie, or null if missing or tampered with. */
export function readSessionToken(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const { valid, value } = request.unsignCookie(raw);
  return valid ? value : null;
}

/** 401 without a valid session, 403 unless the account is active; sets `request.user`. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, context)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = readSessionToken(request);
    const user = token ? await this.auth.resolveSession(token) : null;
    if (!user) throw new UnauthorizedException();
    if (user.status !== 'active') throw new ForbiddenException('Account is not active');
    request.user = user;
    return true;
  }
}
