import { BadRequestException, HttpException } from '@nestjs/common';
import { type Entry, fromBufferPromise, type ZipFile } from 'yauzl';
import type { ProjectFiles } from '../domain/project-storage';
import { checkPath, isGitPath, limitBytes } from './project-files';

export const MAX_ZIP_ENTRIES = 5000;

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

const invalidArchive = (e: unknown) =>
  e instanceof HttpException
    ? e
    : new BadRequestException(`Invalid archive: ${(e as Error).message}`);

/**
 * Extracts `zip` into the project. Everything that can be checked from the central directory
 * (entry count, declared sizes, paths) is checked before anything is written.
 */
export async function extractZip(zip: Buffer, files: ProjectFiles, quotaBytes: number) {
  let archive: ZipFile;
  try {
    archive = await fromBufferPromise(zip, { lazyEntries: true, autoClose: false });
  } catch (e) {
    throw invalidArchive(e);
  }
  try {
    if (archive.entryCount > MAX_ZIP_ENTRIES) {
      throw new BadRequestException(`Archive has more than ${MAX_ZIP_ENTRIES} entries`);
    }
    const entries: Array<{ entry: Entry; name: string }> = [];
    let declared = 0;
    try {
      // yauzl itself rejects absolute paths and `..` segments here.
      for await (const entry of archive.eachEntry()) {
        const name = entry.fileName.replaceAll('\\', '/');
        if (name.endsWith('/')) continue;
        if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) continue;
        // A `.git` directory could plant hooks or config in the project repository.
        if (isGitPath(name)) continue;
        declared += entry.uncompressedSize;
        if (declared > quotaBytes) {
          throw new BadRequestException('Archive exceeds the project quota');
        }
        entries.push({ entry, name });
      }
    } catch (e) {
      throw invalidArchive(e);
    }

    const root = entries[0]?.name.split('/')[0] ?? '';
    const strip = entries.every((e) => e.name.startsWith(`${root}/`));
    const items = entries.map(({ entry, name }) => ({
      entry,
      path: strip ? name.slice(root.length + 1) : name,
    }));
    for (const { path } of items) checkPath(files, path);

    // Declared sizes can lie; count the bytes actually inflated as well.
    const budget = { left: quotaBytes };
    const tooLarge = () => new BadRequestException('Archive exceeds the project quota');
    for (const { entry, path } of items) {
      try {
        const stream = await archive.openReadStreamPromise(entry);
        await files.writeStream(path, limitBytes(stream, budget, tooLarge));
      } catch (e) {
        throw invalidArchive(e);
      }
    }
  } finally {
    archive.close();
  }
}
