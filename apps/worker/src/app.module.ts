import {
  COMPILE_QUEUE,
  ConfigModule,
  DatabaseModule,
  QUEUE_CONNECTION,
  QueueModule,
  queueOptions,
  TOOLS_QUEUE,
} from '@latex-studio/core';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CompileProcessor } from './compile/compile.processor';
import { LatexmkRunner } from './compile/latexmk-runner';
import { Sandbox } from './compile/sandbox';
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
    BullModule.registerQueue({ name: COMPILE_QUEUE }, { name: TOOLS_QUEUE }),
  ],
  providers: [Sandbox, LatexmkRunner, CompileProcessor, ToolsProcessor],
})
export class AppModule {}
