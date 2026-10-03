import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { PackagesService } from './application/packages.service';
import { PackagesController } from './presentation/packages.controller';

@Module({
  imports: [ProjectsModule],
  controllers: [PackagesController],
  providers: [PackagesService],
})
export class PackagesModule {}
