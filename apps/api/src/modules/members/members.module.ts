import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { MembersService } from './application/members.service';
import { MembersController } from './presentation/members.controller';

@Module({
  imports: [ProjectsModule, UsersModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
