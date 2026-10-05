import { QUEUE_CONNECTION, QueueModule, queueOptions, TOOLS_QUEUE } from '@latex-studio/core';
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
      useFactory: queueOptions,
    }),
    BullModule.registerQueue({ name: TOOLS_QUEUE }),
  ],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
