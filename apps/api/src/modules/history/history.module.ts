import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { HistoryService } from './application/history.service';
import { HistoryController } from './presentation/history.controller';

@Module({
  imports: [ProjectsModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
