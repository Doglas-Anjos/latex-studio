import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ExportService } from './application/export.service';
import { ExportController } from './presentation/export.controller';

@Module({
  imports: [ProjectsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
