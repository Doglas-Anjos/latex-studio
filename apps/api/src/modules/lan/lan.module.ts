import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { LanService } from './application/lan.service';
import { LanTokenService } from './application/lan-token.service';
import { LAN_REPOSITORY } from './domain/lan.repository';
import { DrizzleLanRepository } from './infrastructure/drizzle-lan.repository';

/** LAN share (phases 1–3a): persistence, PIN logic, authz decisions and session tokens. The guard,
 * WebSocket and HTTP wiring (3b) and the network bind (3c) are not here yet. */
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
