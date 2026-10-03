import { ConfigModule, DatabaseModule } from '@latex-studio/core';
import { Controller, Get, Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { Public } from './modules/auth/presentation/decorators';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [ConfigModule.forRoot(), DatabaseModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
