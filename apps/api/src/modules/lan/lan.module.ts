import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { LanService } from './application/lan.service';
import { LanTokenService } from './application/lan-token.service';
import { LAN_REPOSITORY } from './domain/lan.repository';
import { DrizzleLanRepository } from './infrastructure/drizzle-lan.repository';

/**
 * LAN share. Global so the ProjectRoleGuard (used across every project module) and the
 * IdentityService can consult LanService/LanTokenService without each module importing this one.
 */
@Global()
@Module({
  imports: [UsersModule],
  providers: [
    LanService,
    LanTokenService,
    { provide: LAN_REPOSITORY, useClass: DrizzleLanRepository },
  ],
  exports: [LanService, LanTokenService],
})
export class LanModule {}
