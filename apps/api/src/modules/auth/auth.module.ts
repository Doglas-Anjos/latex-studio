import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { IdentityService } from './application/identity.service';
import { TOKEN_VERIFIER } from './domain/token-verifier';
import { JoseTokenVerifier } from './infrastructure/jose-token-verifier';
import { AuthController } from './presentation/auth.controller';
import { CsrfGuard } from './presentation/guards/csrf.guard';
import { IdentityGuard } from './presentation/guards/identity.guard';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    IdentityService,
    {
      provide: TOKEN_VERIFIER,
      // Null = local mode; the config schema only allows that on localhost.
      useFactory: (config: AppConfig) =>
        config.AUTH_JWKS_URL || config.AUTH_SECRET ? new JoseTokenVerifier(config) : null,
      inject: [APP_CONFIG],
    },
    // Global guards, run in this order.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: IdentityGuard },
  ],
  // CollabModule authenticates WebSocket upgrades, which bypass the guards.
  exports: [IdentityService],
})
export class AuthModule {}
