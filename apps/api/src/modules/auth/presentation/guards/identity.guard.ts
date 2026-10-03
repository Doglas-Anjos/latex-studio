import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { bearerToken, IdentityService } from '../../application/identity.service';
import { isPublic } from '../decorators';

/** 401 without a verifiable bearer token (or, in local mode, never); sets `request.user`. */
@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, context)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const { authorization, host } = request.headers;
    const user = await this.identity.resolve(bearerToken(authorization), host);
    if (!user) throw new UnauthorizedException();
    request.user = user;
    return true;
  }
}
