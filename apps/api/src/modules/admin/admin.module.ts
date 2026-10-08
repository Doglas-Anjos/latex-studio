import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { AdminService } from './application/admin.service';
import { AdminController } from './presentation/admin.controller';

@Module({
  imports: [UsersModule, ProjectsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
