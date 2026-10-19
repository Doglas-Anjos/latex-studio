import { Module } from '@nestjs/common';
import { LanService } from './application/lan.service';
import { LAN_REPOSITORY } from './domain/lan.repository';
import { DrizzleLanRepository } from './infrastructure/drizzle-lan.repository';

/** LAN share (phase 1): persistence + PIN logic only, no HTTP/WebSocket surface yet. */
@Module({
  providers: [LanService, { provide: LAN_REPOSITORY, useClass: DrizzleLanRepository }],
  exports: [LanService],
})
export class LanModule {}
