import { Module } from '@nestjs/common';
import { CollabModule } from '../collab/collab.module';
import { ProjectsModule } from '../projects/projects.module';
import { HistoryService } from './application/history.service';
import { HistoryController } from './presentation/history.controller';

@Module({
  imports: [ProjectsModule, CollabModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
