import 'reflect-metadata';
import { expect, it } from 'vitest';
import { ExportController } from './export.controller';

const requiredRole = (handler: object) => {
  const key = Reflect.getMetadataKeys(handler).find((k) => String(k) === 'Symbol(PROJECT_ROLE)');
  return Reflect.getMetadata(key, handler);
};

it('lets only the owner download the source with its history (.git holds every e-mail)', () => {
  expect(requiredRole(ExportController.prototype.sourceWithHistory)).toBe('owner');
  expect(requiredRole(ExportController.prototype.source)).toBe('viewer');
});
