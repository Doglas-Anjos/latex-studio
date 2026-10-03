import {
  COMPILE_QUEUE,
  ConfigModule,
  DatabaseModule,
  MAINTENANCE_QUEUE,
  QUEUE_CONNECTION,
  type QueueConnection,
  QueueModule,
} from '@latex-studio/core';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CompileProcessor } from './compile/compile.processor';
import { LatexmkRunner } from './compile/latexmk-runner';
import { AutocommitProcessor } from './maintenance/autocommit.processor';

@Module({
  imports: [
    ConfigModule.forWorker(),
    DatabaseModule,
    QueueModule,
    BullModule.forRootAsync({
      imports: [QueueModule],
      inject: [QUEUE_CONNECTION],
      useFactory: (connection: QueueConnection) => ({ connection }),
    }),
    BullModule.registerQueue({ name: COMPILE_QUEUE }, { name: MAINTENANCE_QUEUE }),
  ],
  providers: [LatexmkRunner, CompileProcessor, AutocommitProcessor],
})
export class AppModule {}
