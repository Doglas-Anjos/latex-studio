import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '../../users/domain/user';
import { AuthService, SESSION_TTL_MS } from '../application/auth.service';
// biome-ignore lint/style/useImportType: ValidationPipe needs the DTO classes in design:paramtypes
import { LoginDto, RegisterDto } from './auth.dto';
import { CurrentUser, Public } from './decorators';
import { readSessionToken, SESSION_COOKIE } from './guards/session.guard';

const AUTH_RATE_LIMIT = { rateLimit: { max: 5, timeWindow: '1 minute' } };

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @RouteConfig(AUTH_RATE_LIMIT)
  @Post('register')
  @HttpCode(202)
  async register(@Body() dto: RegisterDto): Promise<{ status: 'pending' }> {
    await this.auth.register(dto.email, dto.name, dto.password);
    return { status: 'pending' };
  }

  @Public()
  @RouteConfig(AUTH_RATE_LIMIT)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<User> {
    const { token, user } = await this.auth.login(dto.email, dto.password);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true, // browsers treat http://localhost as a secure context
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
      signed: true,
    });
    return user;
  }

  // Public so a blocked user, or a stale cookie, can still log out.
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = readSessionToken(request);
    if (token) await this.auth.logout(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: User): User {
    return user;
  }
}
