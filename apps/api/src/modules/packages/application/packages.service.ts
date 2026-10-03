import {
  extractUsepackages,
  insertPackagesInput,
  type PackageManifest,
  parseManifest,
  renderPackagesTex,
} from '@latex-studio/latex-tools';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
const TEX = 'latex-packages.tex';

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

async function writeManifest(files: ProjectFiles, manifest: PackageManifest) {
  await files.write(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  await files.write(TEX, renderPackagesTex(manifest));
}

@Injectable()
export class PackagesService {
  constructor(
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(ProjectLock) private readonly lock: ProjectLock,
  ) {}

  async get(project: Project): Promise<PackageManifest> {
    return this.read(this.storage.open(project.id));
  }

  set(project: Project, user: User, manifest: PackageManifest): Promise<PackageManifest> {
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      const next = normalize(manifest);
      await writeManifest(files, next);
      await files.repo.commitAll('Update packages', author(user));
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
      await writeManifest(files, next);
      await files.repo.commitAll(`Move ${packages.length} packages to the manifest`, author(user));
      return { moved: packages.length, manifest: next };
    });
  }

  private async read(files: ProjectFiles): Promise<PackageManifest> {
    if (!(await files.isFile(MANIFEST))) return [];
    return parseManifest((await files.repo.readFile(MANIFEST)).toString());
  }
}
