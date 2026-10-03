import { ConfigModule, DatabaseModule } from '@latex-studio/core';
import { Module } from '@nestjs/common';

@Module({ imports: [ConfigModule.forRoot(), DatabaseModule] })
export class AppModule {}
