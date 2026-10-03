import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Mutations must carry `X-Requested-With: fetch`. Cross-site forms cannot set custom headers,
 * and a cross-origin fetch that does needs a CORS preflight, which this API never approves.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method) || request.headers['x-requested-with'] === 'fetch') {
      return true;
    }
    throw new ForbiddenException('Missing X-Requested-With header');
  }
}
