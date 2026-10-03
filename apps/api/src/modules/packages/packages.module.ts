import { Module } from '@nestjs/common';
import { CollabModule } from '../collab/collab.module';
import { ProjectsModule } from '../projects/projects.module';
import { PackagesService } from './application/packages.service';
import { PackagesController } from './presentation/packages.controller';

@Module({
  imports: [ProjectsModule, CollabModule],
  controllers: [PackagesController],
  providers: [PackagesService],
})
export class PackagesModule {}
