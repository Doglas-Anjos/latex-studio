import { Module } from '@nestjs/common';
import { USER_REPOSITORY } from './domain/user.repository';
import { DrizzleUserRepository } from './infrastructure/drizzle-user.repository';

@Module({
  providers: [{ provide: USER_REPOSITORY, useClass: DrizzleUserRepository }],
  exports: [USER_REPOSITORY],
})
export class UsersModule {}
