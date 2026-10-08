import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ReferencesService } from './application/references.service';
import { ReferencesController } from './presentation/references.controller';

@Module({
  imports: [ProjectsModule],
  controllers: [ReferencesController],
  providers: [ReferencesService],
})
export class ReferencesModule {}
