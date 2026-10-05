import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AppConfig } from '@latex-studio/core';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '../../projects/domain/project';
import type { User } from '../../users/domain/user';
import type { Build, BuildRepository, NewBuild } from '../domain/build.repository';
import { type CompileQueue, CompileService, STALE_BUILD_BUFFER_MS } from './compile.service';

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
      info: [],
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
  async cancel(buildId: string) {
    const row = this.rows.find((b) => b.id === buildId);
    if (!row || (row.status !== 'queued' && row.status !== 'running')) return false;
    row.status = 'cancelled';
    row.finishedAt = new Date();
    return true;
  }
  async failStale(buildId: string, message: string) {
    const row = this.rows.find((b) => b.id === buildId);
    if (!row || (row.status !== 'queued' && row.status !== 'running')) return false;
    row.status = 'failed';
    row.errors = [{ message }];
    row.finishedAt = new Date();
    return true;
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
  createdAt: new Date(),
};

describe('CompileService.request', () => {
  let builds: FakeBuilds;
  let added: Array<{ name: string; data: unknown; opts: unknown }>;
  let removed: string[];
  let service: CompileService;

  beforeEach(() => {
    builds = new FakeBuilds();
    added = [];
    removed = [];
    const queue = {
      add: async (name: string, data: unknown, opts: unknown) => {
        added.push({ name, data, opts });
        return {};
      },
      remove: async (id: string) => {
        removed.push(id);
        return 1;
      },
    } as unknown as CompileQueue;
    service = new CompileService(builds, queue, {
      BUILDS_DIR: '/builds',
      COMPILE_TIMEOUT_MS: 180_000,
    } as AppConfig);
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

  it('refuses a second build while one is queued or running (409) until it is cancelled', async () => {
    const p = project();
    const first = await service.request(p, ana, { draft: true });
    expect(first.options).toEqual({ draft: true });
    await expect(service.request(p, ana)).rejects.toMatchObject({ status: 409 });
    (builds.rows[0] as Build).status = 'running';
    await expect(service.request(p, ana)).rejects.toMatchObject({ status: 409 });
    const cancelled = await service.cancel(p, first.id);
    expect(cancelled.status).toBe('cancelled');
    expect(removed).toEqual([first.id]);
    await expect(service.cancel(p, first.id)).rejects.toMatchObject({ status: 409 });
    const second = await service.request(p, ana);
    expect(second.id).not.toBe(first.id);
  });

  it('fails a stale queued build and queues a fresh one instead of reusing it', async () => {
    const p = project();
    const first = await service.request(p, ana);
    first.createdAt = new Date(Date.now() - (180_000 + STALE_BUILD_BUFFER_MS + 1));

    const second = await service.request(p, ana);

    expect(second.id).not.toBe(first.id);
    expect(builds.rows.find((b) => b.id === first.id)?.status).toBe('failed');
    expect(second.status).toBe('queued');
  });

  it('fails a stale running build (crashed worker) and queues a fresh one', async () => {
    const p = project();
    const first = await service.request(p, ana);
    first.status = 'running';
    first.startedAt = new Date(Date.now() - (180_000 + STALE_BUILD_BUFFER_MS + 1));

    const second = await service.request(p, ana);

    expect(second.id).not.toBe(first.id);
    expect(builds.rows.find((b) => b.id === first.id)?.status).toBe('failed');
  });

  it('refuses while a build is merely slow, not stale, and leaves it running', async () => {
    const p = project();
    await service.request(p, ana);
    (builds.rows[0] as Build).status = 'running';
    (builds.rows[0] as Build).startedAt = new Date(Date.now() - 60_000);
    await expect(service.request(p, ana)).rejects.toMatchObject({ status: 409 });
    expect(builds.rows[0]?.status).toBe('running');
    expect(builds.rows).toHaveLength(1);
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
