import { describe, expect, it } from 'vitest';
import { toBuildStatus } from './log-to-build';

describe('toBuildStatus', () => {
  it('succeeds on exit 0 with a PDF', () => {
    expect(toBuildStatus({ exitCode: 0, timedOut: false, pdfExists: true })).toBe('succeeded');
  });
  it('fails on exit 0 without a PDF', () => {
    expect(toBuildStatus({ exitCode: 0, timedOut: false, pdfExists: false })).toBe('failed');
  });
  it('fails on a non-zero exit even with a PDF', () => {
    expect(toBuildStatus({ exitCode: 12, timedOut: false, pdfExists: true })).toBe('failed');
  });
  it('reports a timeout whatever else happened', () => {
    expect(toBuildStatus({ exitCode: -1, timedOut: true, pdfExists: true })).toBe('timeout');
  });
});
