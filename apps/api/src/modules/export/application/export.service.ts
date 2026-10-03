import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { ZipFile } from 'yazl';
import type { Project } from '../../projects/domain/project';
import { PROJECT_STORAGE, type ProjectStorage } from '../../projects/domain/project-storage';

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

@Injectable()
export class ExportService {
  constructor(@Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage) {}

  async sourceZip(project: Project): Promise<Readable> {
    const files = this.storage.open(project.id);
    const zip = new ZipFile();
    for (const { path } of await files.repo.listFiles()) {
      zip.addFile(files.safe.resolve(path), path);
    }
    zip.end();
    return zip.outputStream as unknown as Readable; // yazl types it as a web ReadableStream
  }
}
