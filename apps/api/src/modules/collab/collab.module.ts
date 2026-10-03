import type { Hocuspocus } from '@hocuspocus/server';
import { type BeforeApplicationShutdown, Inject, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { CollabService } from './application/collab.service';
import { YJS_DOC_REPOSITORY } from './domain/yjs-doc.repository';
import { DrizzleYjsDocRepository } from './infrastructure/drizzle-yjs-doc.repository';
import { createHocuspocus, HOCUSPOCUS } from './infrastructure/hocuspocus.server';

@Module({
  imports: [AuthModule, ProjectsModule],
  providers: [
    CollabService,
    { provide: YJS_DOC_REPOSITORY, useClass: DrizzleYjsDocRepository },
    { provide: HOCUSPOCUS, useFactory: createHocuspocus, inject: [CollabService] },
  ],
  // main.ts wires the `/collab` WebSocket upgrade to this instance.
  exports: [HOCUSPOCUS],
})
export class CollabModule implements BeforeApplicationShutdown {
  constructor(@Inject(HOCUSPOCUS) private readonly hocuspocus: Hocuspocus) {}

  /** Runs debounced stores now, before the database client closes on shutdown. */
  async beforeApplicationShutdown() {
    await Promise.all(
      [...this.hocuspocus.documents.keys()].map((name) =>
        this.hocuspocus.debouncer.executeNow(`onStoreDocument-${name}`),
      ),
    );
  }
}
