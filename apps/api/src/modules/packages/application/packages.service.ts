import {
  extractUsepackages,
  findUsepackages,
  insertPackagesInput,
  type PackageManifest,
  parseManifest,
  renderPackagesTex,
} from '@latex-studio/latex-tools';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { DOCUMENT_SYNC, type DocumentSync } from '../../collab/domain/document-sync';
import { author } from '../../projects/application/project-files';
import { ProjectLock } from '../../projects/application/project-lock';
import type { Project } from '../../projects/domain/project';
import {
  PROJECT_STORAGE,
  type ProjectFiles,
  type ProjectStorage,
} from '../../projects/domain/project-storage';
import type { User } from '../../users/domain/user';

const MANIFEST = 'latex-packages.json';
const MAX_MANIFEST_BYTES = 256 * 1024;
const TEX = 'latex-packages.tex';
const MAX_SCAN_BYTES = 1024 * 1024;

export type PackageUsage = { name: string; options?: string; path: string; line: number };

/** Sorts by `order` and renumbers 0..n-1; throws 400 on an invalid manifest. */
function normalize(manifest: unknown): PackageManifest {
  let parsed: PackageManifest;
  try {
    parsed = parseManifest(JSON.stringify(manifest));
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
  return [...parsed]
    .sort((a, b) => a.order - b.order)
    .map((e, order) => ({
      name: e.name,
      ...(e.options ? { options: e.options } : {}),
      enabled: e.enabled,
      order,
    }));
}

async function writeManifest(
  files: ProjectFiles,
  manifest: PackageManifest,
  usage: PackageUsage[],
) {
  await files.write(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  await files.write(TEX, renderPackagesTex(manifest, usage));
}

@Injectable()
export class PackagesService {
  constructor(
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(ProjectLock) private readonly lock: ProjectLock,
    @Inject(DOCUMENT_SYNC) private readonly sync: DocumentSync,
  ) {}

  async get(project: Project): Promise<PackageManifest> {
    return this.read(this.storage.open(project.id));
  }

  set(project: Project, user: User, manifest: PackageManifest): Promise<PackageManifest> {
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      const next = normalize(manifest);
      const usage = await this.scan(files);
      await writeManifest(files, next, usage);
      const paths = [MANIFEST, TEX];
      // the bypass only runs if the main file loads latex-packages.tex
      const bypassed = next.some((e) => !e.enabled && usage.some((u) => u.name === e.name));
      if (bypassed && (await files.isFile(project.mainFile))) {
        const main = (await files.repo.readFile(project.mainFile)).toString();
        const withInput = insertPackagesInput(main);
        if (withInput !== main) {
          await files.write(project.mainFile, withInput);
          paths.push(project.mainFile);
        }
      }
      await files.repo.commitAll('Update packages', author(user));
      await this.syncDocs(project.id, files, paths);
      return next;
    });
  }

  migrate(project: Project, user: User): Promise<{ moved: number; manifest?: PackageManifest }> {
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      if (!(await files.isFile(project.mainFile)))
        throw new NotFoundException('Main file not found');
      const source = (await files.repo.readFile(project.mainFile)).toString();
      const { packages, remaining } = extractUsepackages(source);
      if (packages.length === 0) return { moved: 0 };

      const manifest = await this.read(files);
      const known = new Set(manifest.map((e) => e.name));
      for (const p of packages) {
        if (known.has(p.name)) continue;
        known.add(p.name);
        manifest.push({ ...p, enabled: true, order: manifest.length });
      }
      await files.write(project.mainFile, insertPackagesInput(remaining));
      const next = normalize(manifest);
      await writeManifest(files, next, await this.scan(files));
      await files.repo.commitAll(`Move ${packages.length} packages to the manifest`, author(user));
      await this.syncDocs(project.id, files, [project.mainFile, MANIFEST, TEX]);
      return { moved: packages.length, manifest: next };
    });
  }

  usage(project: Project): Promise<PackageUsage[]> {
    return this.scan(this.storage.open(project.id));
  }

  /**
   * \usepackage/\RequirePackage in every .tex/.sty/.cls except the generated file.
   * ponytail: does not follow \input outside the project and misses macro-generated
   * \usepackage; a latexmk -recorder pass would catch those.
   */
  private async scan(files: ProjectFiles): Promise<PackageUsage[]> {
    const usage: PackageUsage[] = [];
    for (const f of await files.repo.listFiles()) {
      if (f.path === TEX || f.size > MAX_SCAN_BYTES || !/\.(tex|sty|cls)$/.test(f.path)) continue;
      const source = Buffer.from(await files.repo.readFile(f.path)).toString('utf8');
      for (const u of findUsepackages(source)) usage.push({ ...u, path: f.path });
    }
    return usage;
  }

  /** Pushes the freshly written files into their open docs (caller holds the lock). */
  private async syncDocs(projectId: string, files: ProjectFiles, paths: string[]) {
    for (const path of paths) {
      const text = Buffer.from(await files.repo.readFile(path)).toString('utf8');
      await this.sync.replaceText(projectId, path, text);
    }
  }

  private async read(files: ProjectFiles): Promise<PackageManifest> {
    if (!(await files.isFile(MANIFEST))) return [];
    // An editor can upload any file under this name; parsing 50 MB of JSON blocks the server.
    const head = await files.readHead(MANIFEST, MAX_MANIFEST_BYTES + 1);
    if (head.length > MAX_MANIFEST_BYTES) {
      throw new PayloadTooLargeException(`${MANIFEST} is larger than 256 KB`);
    }
    return parseManifest(head.toString());
  }
}
