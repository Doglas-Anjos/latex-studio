import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import { Controller, Get, Inject } from '@nestjs/common';
import { mayRunTools } from '../../lan/application/lan.service';
import type { User } from '../../users/domain/user';
import { isSuperadmin } from '../superadmin';
import { CurrentUser } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('me')
  me(@CurrentUser() user: User): User & { isAdmin: boolean; hostCompiles: boolean } {
    return {
      ...user,
      isAdmin: isSuperadmin(user.email, this.config),
      // A LAN guest on a host where only the host may compile (see mayRunTools): the web greys the
      // compile/export actions out instead of letting them fail.
      hostCompiles: !mayRunTools(user),
    };
  }
}
