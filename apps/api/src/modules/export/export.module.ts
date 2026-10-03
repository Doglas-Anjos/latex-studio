import {
  QUEUE_CONNECTION,
  type QueueConnection,
  QueueModule,
  TOOLS_QUEUE,
} from '@latex-studio/core';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ExportService } from './application/export.service';
import { ExportController } from './presentation/export.controller';

@Module({
  imports: [
    ProjectsModule,
    QueueModule,
    // Same connection as CompileModule.
    BullModule.forRootAsync({
      imports: [QueueModule],
      inject: [QUEUE_CONNECTION],
      useFactory: (connection: QueueConnection) => ({ connection }),
    }),
    BullModule.registerQueue({ name: TOOLS_QUEUE }),
  ],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
