import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global so any service can `@Optional() @Inject(AuditService)` without importing the module. */
@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
