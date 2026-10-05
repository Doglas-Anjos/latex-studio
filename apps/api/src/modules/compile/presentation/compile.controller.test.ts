import 'reflect-metadata';
import { expect, it } from 'vitest';
import { CompileController } from './compile.controller';

const requiredRole = (handler: object) => {
  const key = Reflect.getMetadataKeys(handler).find((k) => String(k) === 'Symbol(PROJECT_ROLE)');
  return Reflect.getMetadata(key, handler);
};

it('lets viewers compile but only editors cancel a build', () => {
  expect(requiredRole(CompileController.prototype.request)).toBe('viewer');
  expect(requiredRole(CompileController.prototype.cancel)).toBe('editor');
});
