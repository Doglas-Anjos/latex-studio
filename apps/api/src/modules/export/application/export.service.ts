import type { Readable } from 'node:stream';
import {
  APP_CONFIG,
  type AppConfig,
  type ExportFormat,
  SafePath,
  TOOLS_QUEUE,
  type ToolJobData,
} from '@latex-studio/core';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ZipFile } from 'yazl';
import { ProjectsService } from '../../projects/application/projects.service';
import { type Project, parseProjectName } from '../../projects/domain/project';
import { PROJECT_STORAGE, type ProjectStorage } from '../../projects/domain/project-storage';
import type { User } from '../../users/domain/user';

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

export type ToolsQueue = Pick<Queue<ToolJobData>, 'add' | 'getJob'>;

export interface JobStatus {
  state: string;
  result?: unknown;
  error?: string;
}

const KEEP = { age: 3600 };

@Injectable()
export class ExportService {
  private readonly builds: SafePath;

  constructor(
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @InjectQueue(TOOLS_QUEUE) private readonly queue: ToolsQueue,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.builds = new SafePath(config.BUILDS_DIR);
  }

  async sourceZip(project: Project): Promise<Readable> {
    const files = this.storage.open(project.id);
    const zip = new ZipFile();
    for (const { path } of await files.repo.listFiles()) {
      zip.addFile(files.safe.resolve(path), path);
    }
    zip.end();
    return zip.outputStream as unknown as Readable; // yazl types it as a web ReadableStream
  }

  /** New project with the same files and a single commit; the cap is enforced by `createWith`. */
  async copy(project: Project, user: User, name?: string): Promise<Project> {
    const copyName = parseProjectName(name ?? `Copy of ${project.name}`);
    if (!copyName) throw new BadRequestException('Invalid project name');
    const from = this.storage.open(project.id);
    return this.projects.createWith(
      user,
      copyName,
      async (to) => {
        for (const { path } of await from.repo.listFiles()) {
          await to.write(path, await from.repo.readFile(path));
        }
        return `Copy of ${project.name}`;
      },
      project.mainFile,
    );
  }

  requestWordCount(project: Project): Promise<{ jobId: string }> {
    return this.enqueue({ projectId: project.id, kind: 'wordcount' });
  }

  requestExport(project: Project, format: ExportFormat): Promise<{ jobId: string }> {
    return this.enqueue({ projectId: project.id, kind: 'export', format });
  }

  async jobStatus(project: Project, jobId: string): Promise<JobStatus> {
    const job = await this.find(project, jobId);
    const state = await job.getState();
    return {
      state,
      ...(state === 'completed' && { result: job.returnvalue }),
      ...(state === 'failed' && { error: job.failedReason }),
    };
  }

  async exportFile(
    project: Project,
    jobId: string,
  ): Promise<{ path: string; format: ExportFormat }> {
    const job = await this.find(project, jobId);
    const file = (job.returnvalue as { file?: string } | null)?.file;
    if (job.data.kind !== 'export' || !file || (await job.getState()) !== 'completed') {
      throw new NotFoundException('No file for this job');
    }
    return { path: this.builds.resolve(`${project.id}/exports/${file}`), format: job.data.format };
  }

  private async enqueue(data: ToolJobData): Promise<{ jobId: string }> {
    const job = await this.queue.add(data.kind, data, {
      removeOnComplete: KEEP,
      removeOnFail: KEEP,
    });
    return { jobId: String(job.id) };
  }

  private async find(project: Project, jobId: string) {
    const job = /^\d+$/.test(jobId) ? await this.queue.getJob(jobId) : undefined;
    if (!job || job.data.projectId !== project.id) throw new NotFoundException('Job not found');
    return job;
  }
}
