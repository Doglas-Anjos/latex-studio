import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** Runs after the global SessionGuard, which sets `request.user`. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<FastifyRequest>().user?.role !== 'admin') {
      throw new ForbiddenException('Admin only');
    }
    return true;
  }
}
