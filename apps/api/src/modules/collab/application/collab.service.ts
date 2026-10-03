import { extname } from 'node:path';
import { unsign } from '@fastify/cookie';
import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import * as Y from 'yjs';
import { AuthService } from '../../auth/application/auth.service';
import { SESSION_COOKIE } from '../../auth/presentation/guards/session.guard';
import { ProjectLock } from '../../projects/application/project-lock';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from '../../projects/domain/project.repository';
import { PROJECT_STORAGE, type ProjectStorage } from '../../projects/domain/project-storage';
import type { User } from '../../users/domain/user';
import { YJS_DOC_REPOSITORY, type YjsDocRepository } from '../domain/yjs-doc.repository';

const TEXT_EXTENSIONS = new Set(['.tex', '.bib', '.sty', '.cls', '.txt', '.md', '.json']);

/** `@fastify/cookie`'s parse needs the plugin loaded; this reads one URI-encoded cookie. */
function readCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface CollabSession {
  user: User;
  projectId: string;
  path: string;
  readOnly: boolean;
}

/**
 * Backs the Hocuspocus hooks. WebSocket upgrades bypass Nest guards, so `authenticate` checks
 * the Origin, the signed session cookie and the project role itself.
 * ponytail: renaming or deleting a file that is open in the editor is not handled; the next
 * store rewrites the old path and its `yjs_docs` row lingers. Close the doc and delete the
 * row from the files service when that lands.
 */
@Injectable()
export class CollabService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(YJS_DOC_REPOSITORY) private readonly docs: YjsDocRepository,
    @Inject(ProjectLock) private readonly lock: ProjectLock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** `"<projectId>/<path>"` → its parts; only text files inside the project. */
  parseDocumentName(documentName: string): { projectId: string; path: string } {
    const slash = documentName.indexOf('/');
    const projectId = documentName.slice(0, slash);
    const path = documentName.slice(slash + 1);
    if (slash < 0 || !isUUID(projectId) || !TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
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
    cookieHeader: string | null;
    origin: string | null;
    documentName: string;
  }): Promise<CollabSession> {
    if (!input.origin || !this.sameOrigin(input.origin)) throw new ForbiddenException('Bad origin');
    const { projectId, path } = this.parseDocumentName(input.documentName);

    const raw = input.cookieHeader ? readCookie(input.cookieHeader, SESSION_COOKIE) : null;
    const token = raw ? unsign(raw, this.config.SESSION_SECRET) : null;
    const user = token?.valid ? await this.auth.resolveSession(token.value) : null;
    if (!user) throw new UnauthorizedException();
    if (user.status !== 'active') throw new ForbiddenException('Account is not active');

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
    await files.safe.resolveExisting(path);
    return Buffer.from(await files.repo.readFile(path)).toString('utf8');
  }

  /**
   * Persists the Yjs state, flushes the text to the working tree and flags the project for
   * autocommit.
   * ponytail: no quota check on flush (it would list the whole tree every 2 s); the project
   * quota is enforced on uploads only.
   */
  async store(projectId: string, path: string, doc: Y.Doc): Promise<void> {
    await this.docs.save(projectId, path, Y.encodeStateAsUpdate(doc));
    const text = doc.getText('content').toString();
    await this.lock.run(projectId, () => this.storage.open(projectId).write(path, text));
    await this.projects.markDirty(projectId);
  }

  private sameOrigin(origin: string): boolean {
    try {
      return new URL(origin).origin === new URL(this.config.APP_URL).origin;
    } catch {
      return false;
    }
  }
}
