import { ConfigModule, DatabaseModule } from '@latex-studio/core';
import { Controller, Get, Module } from '@nestjs/common';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { Public } from './modules/auth/presentation/decorators';
import { CollabModule } from './modules/collab/collab.module';
import { CompileModule } from './modules/compile/compile.module';
import { ExportModule } from './modules/export/export.module';
import { FilesModule } from './modules/files/files.module';
import { PackagesModule } from './modules/packages/packages.module';
import { ProjectsModule } from './modules/projects/projects.module';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot(),
    DatabaseModule,
    AuthModule,
    AdminModule,
    ProjectsModule,
    FilesModule,
    CollabModule,
    CompileModule,
    ExportModule,
    PackagesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
