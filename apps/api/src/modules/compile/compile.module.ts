import { COMPILE_QUEUE, QUEUE_CONNECTION, QueueModule, queueOptions } from '@latex-studio/core';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CollabModule } from '../collab/collab.module';
import { ProjectsModule } from '../projects/projects.module';
import { CompileService } from './application/compile.service';
import { BUILD_REPOSITORY } from './domain/build.repository';
import { DrizzleBuildRepository } from './infrastructure/drizzle-build.repository';
import { CompileController } from './presentation/compile.controller';

@Module({
  imports: [
    ProjectsModule,
    CollabModule,
    QueueModule,
    BullModule.forRootAsync({
      imports: [QueueModule],
      inject: [QUEUE_CONNECTION],
      useFactory: queueOptions,
    }),
    BullModule.registerQueue({ name: COMPILE_QUEUE }),
  ],
  controllers: [CompileController],
  providers: [CompileService, { provide: BUILD_REPOSITORY, useClass: DrizzleBuildRepository }],
})
export class CompileModule {}
