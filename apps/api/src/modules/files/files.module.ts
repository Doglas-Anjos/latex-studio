import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { FilesService } from './application/files.service';
import { FilesController } from './presentation/files.controller';

@Module({
  imports: [ProjectsModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
