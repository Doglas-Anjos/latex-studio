import { ConfigModule, DatabaseModule } from '@latex-studio/core';
import { Controller, Get, Module } from '@nestjs/common';

@Controller('health')
class HealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [ConfigModule.forRoot(), DatabaseModule],
  controllers: [HealthController],
})
export class AppModule {}
