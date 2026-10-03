import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AppConfig } from '@latex-studio/core';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '../../projects/domain/project';
import type { User } from '../../users/domain/user';
import type { Build, BuildRepository, NewBuild } from '../domain/build.repository';
import { type CompileQueue, CompileService } from './compile.service';

class FakeBuilds implements BuildRepository {
  rows: Build[] = [];

  async create(build: NewBuild) {
    const row: Build = {
      ...build,
      id: randomUUID(),
      status: 'queued',
      commitSha: null,
      exitCode: null,
      errors: [],
      warnings: [],
      createdAt: new Date(Date.now() + this.rows.length),
      startedAt: null,
      finishedAt: null,
    };
    this.rows.push(row);
    return row;
  }
  async findById(projectId: string, buildId: string) {
    return this.rows.find((b) => b.id === buildId && b.projectId === projectId) ?? null;
  }
  async listForProject(projectId: string, limit: number) {
    return this.rows
      .filter((b) => b.projectId === projectId)
      .reverse()
      .slice(0, limit);
  }
  async findActive(projectId: string) {
    const active = this.rows.filter(
      (b) => b.projectId === projectId && (b.status === 'queued' || b.status === 'running'),
    );
    return active.at(-1) ?? null;
  }
  async countQueuedForUser(userId: string) {
    return this.rows.filter((b) => b.requestedBy === userId && b.status === 'queued').length;
  }
}

const project = (id = randomUUID()): Project => ({
  id,
  ownerId: 'owner',
  name: 'Thesis',
  mainFile: 'main.tex',
  engine: 'xelatex',
  createdAt: new Date(),
  updatedAt: new Date(),
});

const ana: User = {
  id: randomUUID(),
  email: 'ana@example.com',
  name: 'Ana',
  role: 'user',
  status: 'active',
  createdAt: new Date(),
};

describe('CompileService.request', () => {
  let builds: FakeBuilds;
  let added: Array<{ name: string; data: unknown; opts: unknown }>;
  let service: CompileService;

  beforeEach(() => {
    builds = new FakeBuilds();
    added = [];
    const queue = {
      add: async (name: string, data: unknown, opts: unknown) => {
        added.push({ name, data, opts });
        return {};
      },
    } as unknown as CompileQueue;
    service = new CompileService(builds, queue, { BUILDS_DIR: '/builds' } as AppConfig);
  });

  it('creates a queued build and enqueues it with jobId = buildId', async () => {
    const p = project();
    const build = await service.request(p, ana);
    expect(build).toMatchObject({
      projectId: p.id,
      requestedBy: ana.id,
      engine: 'xelatex',
      mainFile: 'main.tex',
      status: 'queued',
    });
    expect(added).toEqual([
      {
        name: 'compile',
        data: { buildId: build.id, projectId: p.id },
        opts: { jobId: build.id, removeOnComplete: true, removeOnFail: true },
      },
    ]);
  });

  it('returns the queued build of the project instead of creating another', async () => {
    const p = project();
    const first = await service.request(p, ana);
    const second = await service.request(p, ana);
    expect(second.id).toBe(first.id);
    expect(builds.rows).toHaveLength(1);
  });

  it('queues one build behind a running one', async () => {
    const p = project();
    const first = await service.request(p, ana);
    first.status = 'running';
    const second = await service.request(p, ana);
    expect(second.id).not.toBe(first.id);
  });

  it('answers 429 once the user has 3 queued builds', async () => {
    for (let i = 0; i < 3; i++) await service.request(project(), ana);
    const error = await service.request(project(), ana).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(builds.rows).toHaveLength(3);
  });

  it('keeps build output paths under BUILDS_DIR', () => {
    const fake = { projectId: 'p1', id: 'b1' } as Build;
    expect(service.pdfPath(fake)).toBe(join('/builds', 'p1', 'b1', 'output.pdf'));
    expect(() => service.pdfPath({ projectId: '..', id: 'b1' } as Build)).toThrow();
  });
});
