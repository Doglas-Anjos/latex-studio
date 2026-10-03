import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { AuthService } from './application/auth.service';
import { PASSWORD_HASHER } from './domain/password-hasher';
import { SESSION_REPOSITORY } from './domain/session.repository';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { DrizzleSessionRepository } from './infrastructure/drizzle-session.repository';
import { AuthController } from './presentation/auth.controller';
import { CsrfGuard } from './presentation/guards/csrf.guard';
import { SessionGuard } from './presentation/guards/session.guard';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: SESSION_REPOSITORY, useClass: DrizzleSessionRepository },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    // Global guards, run in this order.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AuthModule {}
