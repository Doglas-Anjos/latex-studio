import {
  COMPILE_QUEUE,
  QUEUE_CONNECTION,
  type QueueConnection,
  QueueModule,
} from '@latex-studio/core';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { CompileService } from './application/compile.service';
import { BUILD_REPOSITORY } from './domain/build.repository';
import { DrizzleBuildRepository } from './infrastructure/drizzle-build.repository';
import { CompileController } from './presentation/compile.controller';

@Module({
  imports: [
    ProjectsModule,
    QueueModule,
    BullModule.forRootAsync({
      imports: [QueueModule],
      inject: [QUEUE_CONNECTION],
      useFactory: (connection: QueueConnection) => ({ connection }),
    }),
    BullModule.registerQueue({ name: COMPILE_QUEUE }),
  ],
  controllers: [CompileController],
  providers: [CompileService, { provide: BUILD_REPOSITORY, useClass: DrizzleBuildRepository }],
})
export class CompileModule {}
