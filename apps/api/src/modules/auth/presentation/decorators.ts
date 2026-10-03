import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { User } from '../../users/domain/user';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

const IS_PUBLIC = Symbol('IS_PUBLIC');

/** Skips SessionGuard (CsrfGuard still applies). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const isPublic = (reflector: Reflector, context: ExecutionContext) =>
  reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]) ===
  true;

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): User => {
  const user = context.switchToHttp().getRequest<FastifyRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});
