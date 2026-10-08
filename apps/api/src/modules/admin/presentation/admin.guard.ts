import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { isSuperadmin } from '../../auth/superadmin';

/** Allows only platform superadmins; runs after the global IdentityGuard has set request.user. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<FastifyRequest>().user;
    if (!user || !isSuperadmin(user.email, this.config)) {
      throw new ForbiddenException('Superadmin only');
    }
    return true;
  }
}
