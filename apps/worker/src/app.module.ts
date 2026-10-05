import {
  COMPILE_QUEUE,
  ConfigModule,
  DatabaseModule,
  MAINTENANCE_QUEUE,
  QUEUE_CONNECTION,
  QueueModule,
  queueOptions,
  TOOLS_QUEUE,
} from '@latex-studio/core';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CompileProcessor } from './compile/compile.processor';
import { LatexmkRunner } from './compile/latexmk-runner';
import { AutocommitProcessor } from './maintenance/autocommit.processor';
import { ToolsProcessor } from './tools/tools.processor';

@Module({
  imports: [
    ConfigModule.forWorker(),
    DatabaseModule,
    QueueModule,
    BullModule.forRootAsync({
      imports: [QueueModule],
      inject: [QUEUE_CONNECTION],
      useFactory: queueOptions,
    }),
    BullModule.registerQueue(
      { name: COMPILE_QUEUE },
      { name: MAINTENANCE_QUEUE },
      { name: TOOLS_QUEUE },
    ),
  ],
  providers: [LatexmkRunner, CompileProcessor, AutocommitProcessor, ToolsProcessor],
})
export class AppModule {}
