import { HttpException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { UploadPart } from '../application/project-files';

export const UPLOAD_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };
export const IMPORT_RATE_LIMIT = { rateLimit: { max: 5, timeWindow: '1 minute' } };

/**
 * Multipart parts with filenames kept as relative paths (busboy strips directories by default).
 * `@fastify/multipart` errors (file too large, too many files, not multipart) carry a 4xx
 * `statusCode` that Nest would turn into a 500, so `run` rethrows them as HttpExceptions.
 */
export async function withParts<T>(
  request: FastifyRequest,
  run: (parts: AsyncIterable<UploadPart>) => Promise<T>,
): Promise<T> {
  try {
    return await run(request.parts({ preservePath: true }) as AsyncIterable<UploadPart>);
  } catch (e) {
    const status = (e as { statusCode?: unknown }).statusCode;
    if (
      !(e instanceof HttpException) &&
      typeof status === 'number' &&
      status >= 400 &&
      status < 500
    ) {
      throw new HttpException((e as Error).message, status);
    }
    throw e;
  }
}
