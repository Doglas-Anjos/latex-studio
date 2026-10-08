import 'reflect-metadata';
import { expect, it } from 'vitest';
import { CompileController } from './compile.controller';

const requiredRole = (handler: object) => {
  const key = Reflect.getMetadataKeys(handler).find((k) => String(k) === 'Symbol(PROJECT_ROLE)');
  return Reflect.getMetadata(key, handler);
};

it('lets only editors compile and cancel a build', () => {
  expect(requiredRole(CompileController.prototype.request)).toBe('editor');
  expect(requiredRole(CompileController.prototype.cancel)).toBe('editor');
});
