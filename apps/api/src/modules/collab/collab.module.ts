import type { Hocuspocus } from '@hocuspocus/server';
import { type BeforeApplicationShutdown, forwardRef, Inject, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { CollabService } from './application/collab.service';
import { DOCUMENT_SYNC } from './domain/document-sync';
import { YJS_DOC_REPOSITORY } from './domain/yjs-doc.repository';
import { DrizzleYjsDocRepository } from './infrastructure/drizzle-yjs-doc.repository';
import { createHocuspocus, HOCUSPOCUS } from './infrastructure/hocuspocus.server';
import { HocuspocusDocumentSync } from './infrastructure/hocuspocus-document-sync';

@Module({
  imports: [AuthModule, forwardRef(() => ProjectsModule)],
  providers: [
    CollabService,
    { provide: YJS_DOC_REPOSITORY, useClass: DrizzleYjsDocRepository },
    { provide: HOCUSPOCUS, useFactory: createHocuspocus, inject: [CollabService] },
    { provide: DOCUMENT_SYNC, useClass: HocuspocusDocumentSync },
  ],
  // main.ts wires the `/collab` WebSocket upgrade to this instance; DOCUMENT_SYNC keeps open
  // docs in step with REST writes (files, history, packages).
  exports: [HOCUSPOCUS, DOCUMENT_SYNC],
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
