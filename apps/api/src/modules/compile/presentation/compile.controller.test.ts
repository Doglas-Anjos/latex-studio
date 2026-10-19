import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExportService } from '../../export/application/export.service';
import { ExportController } from '../../export/presentation/export.controller';
import type { Project } from '../../projects/domain/project';
import { LAN_ISSUER, type User } from '../../users/domain/user';
import type { CompileService } from '../application/compile.service';
import { CompileController } from './compile.controller';

const requiredRole = (handler: object) => {
  const key = Reflect.getMetadataKeys(handler).find((k) => String(k) === 'Symbol(PROJECT_ROLE)');
  return Reflect.getMetadata(key, handler);
};

it('lets only editors compile and cancel a build', () => {
  expect(requiredRole(CompileController.prototype.request)).toBe('editor');
  expect(requiredRole(CompileController.prototype.cancel)).toBe('editor');
});

const platform = process.platform;
afterEach(() => Object.defineProperty(process, 'platform', { value: platform }));

it('refuses every tool a LAN guest could start on a Windows host, before any job is queued', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const compile = { request: vi.fn(), cancel: vi.fn() };
  const exporter = { requestWordCount: vi.fn(), requestExport: vi.fn() };
  const builds = new CompileController(compile as unknown as CompileService);
  const exports = new ExportController(exporter as unknown as ExportService);
  const project = { id: 'p' } as Project;
  const guest = { id: 'g', issuer: LAN_ISSUER } as User;
  const id = '00000000-0000-4000-8000-000000000001';

  expect(() => builds.request(project, guest, {})).toThrow(ForbiddenException);
  expect(() => builds.cancel(project, guest, id)).toThrow(ForbiddenException);
  expect(() => exports.wordCount(project, guest)).toThrow(ForbiddenException);
  expect(() => exports.requestExport(project, guest, 'docx')).toThrow(ForbiddenException);
  expect(
    [...Object.values(compile), ...Object.values(exporter)].every((f) => !f.mock.calls.length),
  ).toBe(true);

  // The host on the same machine is not affected.
  builds.request(project, { id: 'h', issuer: 'local' } as User, {});
  expect(compile.request).toHaveBeenCalledOnce();
});
