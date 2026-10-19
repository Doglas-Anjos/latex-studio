import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { LanService } from './application/lan.service';
import { LAN_REPOSITORY } from './domain/lan.repository';
import { DrizzleLanRepository } from './infrastructure/drizzle-lan.repository';

/** LAN share (phases 1–2): persistence, PIN logic and authz decisions; no HTTP/WebSocket yet. */
@Module({
  imports: [UsersModule],
  providers: [LanService, { provide: LAN_REPOSITORY, useClass: DrizzleLanRepository }],
  exports: [LanService],
})
export class LanModule {}
