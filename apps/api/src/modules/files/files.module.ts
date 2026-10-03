import { Module } from '@nestjs/common';
import { CollabModule } from '../collab/collab.module';
import { ProjectsModule } from '../projects/projects.module';
import { FilesService } from './application/files.service';
import { FilesController } from './presentation/files.controller';

@Module({
  imports: [ProjectsModule, CollabModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
