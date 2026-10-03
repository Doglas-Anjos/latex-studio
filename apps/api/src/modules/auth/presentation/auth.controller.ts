import { Controller, Get } from '@nestjs/common';
import type { User } from '../../users/domain/user';
import { CurrentUser } from './decorators';

@Controller('auth')
export class AuthController {
  @Get('me')
  me(@CurrentUser() user: User): User {
    return user;
  }
}
