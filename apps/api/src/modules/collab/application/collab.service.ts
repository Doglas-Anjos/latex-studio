import { extname } from 'node:path';
import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import * as Y from 'yjs';
import { IdentityService } from '../../auth/application/identity.service';
import { ProjectLock } from '../../projects/application/project-lock';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from '../../projects/domain/project.repository';
import { PROJECT_STORAGE, type ProjectStorage } from '../../projects/domain/project-storage';
import type { User } from '../../users/domain/user';
import { YJS_DOC_REPOSITORY, type YjsDocRepository } from '../domain/yjs-doc.repository';

export const TEXT_EXTENSIONS = new Set(['.tex', '.bib', '.sty', '.cls', '.txt', '.md', '.json']);
/** Largest text a collaborative doc may hold; a file of this many bytes has at most as many chars. */
export const MAX_DOC_CHARS = 8 * 1024 * 1024;

export interface CollabSession {
  user: User;
  projectId: string;
  path: string;
  readOnly: boolean;
}

/**
 * Backs the Hocuspocus hooks. WebSocket upgrades bypass Nest guards, so `authenticate` checks
 * the Origin, the bearer token (sent by the provider in its auth message) and the project role.
 */
@Injectable()
export class CollabService {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(YJS_DOC_REPOSITORY) private readonly docs: YjsDocRepository,
    @Inject(ProjectLock) private readonly lock: ProjectLock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * `"<projectId>/<path>"` → its parts; only text files inside the project. The id must be the
   * canonical lowercase one: Postgres matches any case, but revoke/forget/flush match documents
   * by name, and an uppercase twin would escape them.
   */
  parseDocumentName(documentName: string): { projectId: string; path: string } {
    const slash = documentName.indexOf('/');
    const projectId = documentName.slice(0, slash);
    const path = documentName.slice(slash + 1);
    if (
      slash < 0 ||
      !isUUID(projectId) ||
      projectId !== projectId.toLowerCase() ||
      !TEXT_EXTENSIONS.has(extname(path).toLowerCase())
    ) {
      throw new BadRequestException('Invalid document name');
    }
    try {
      this.storage.open(projectId).safe.resolve(path);
    } catch {
      throw new BadRequestException('Invalid document name');
    }
    return { projectId, path };
  }

  async authenticate(input: {
    token: string;
    origin: string | null;
    host: string | null;
    documentName: string;
  }): Promise<CollabSession> {
    if (!input.origin || !this.sameOrigin(input.origin)) throw new ForbiddenException('Bad origin');
    const { projectId, path } = this.parseDocumentName(input.documentName);

    const user = await this.identity.resolve(input.token || null, input.host ?? undefined);
    if (!user) throw new UnauthorizedException();

    const role = await this.projects.roleOf(projectId, user.id);
    if (!role) throw new ForbiddenException();
    return { user, projectId, path, readOnly: role === 'viewer' || role === 'reviewer' };
  }

  /** Saved Yjs state, or the file's text when the document was never opened collaboratively. */
  async load(projectId: string, path: string): Promise<Uint8Array | string> {
    const state = await this.docs.load(projectId, path);
    if (state) return state;
    const files = this.storage.open(projectId);
    // isFile refuses folders and a symlinked leaf; resolveExisting a symlinked parent folder.
    if (!(await files.isFile(path))) throw new NotFoundException('File not found');
    // readHead also refuses a symlinked parent; one byte past the cap is enough to refuse.
    const head = await files.readHead(path, MAX_DOC_CHARS + 1);
    if (head.length > MAX_DOC_CHARS) throw new PayloadTooLargeException('File too large to edit');
    return head.toString('utf8');
  }

  /** Called on every update; the repository throttles the writes. */
  recordEdit(projectId: string, path: string, userId: string): Promise<void> {
    return this.projects.recordEdit(projectId, path, userId);
  }

  saveState(projectId: string, path: string, doc: Y.Doc): Promise<void> {
    return this.docs.save(projectId, path, Y.encodeStateAsUpdate(doc));
  }

  /**
   * Autosave: persists the Yjs state and flushes the text to the working tree. Never commits.
   * Resolves to the state's size in bytes.
   * ponytail: no quota check on flush (it would list the whole tree every 2 s); the project
   * quota is enforced on uploads only.
   */
  store(projectId: string, path: string, doc: Y.Doc): Promise<number> {
    return this.lock.run(projectId, async () => {
      // Dropped while waiting (an upload/restore over the cap, a rename or delete): a destroyed doc
      // still encodes its old text, which would overwrite what that turn just wrote.
      if (doc.isDestroyed) return 0;
      // Snapshot both the instant this turn starts, before any await: a store queued behind a
      // `commitFile` (or another store) must persist what the doc holds right now, never a value
      // captured earlier while waiting its turn, which could by now be older than what an earlier
      // turn already wrote. Taking both from the same instant also keeps the Yjs row and the
      // working tree text in step with each other.
      const state = Y.encodeStateAsUpdate(doc);
      const text = doc.getText('content').toString();
      await this.docs.save(projectId, path, state);
      await this.storage.open(projectId).write(path, text);
      return state.byteLength;
    });
  }

  private sameOrigin(origin: string): boolean {
    try {
      return new URL(origin).origin === new URL(this.config.APP_URL).origin;
    } catch {
      return false;
    }
  }
}
