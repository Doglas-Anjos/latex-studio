import { validateHeaderValue } from 'node:http';
import { expect, it } from 'vitest';
import { attachment } from './content-types';

it('builds a Content-Disposition that Node accepts for any Unicode name', () => {
  const header = attachment('Ação "1" (rev)*.png');
  expect(() => validateHeaderValue('Content-Disposition', header)).not.toThrow();
  expect(header).toBe(
    `attachment; filename="A__o _1_ (rev)*.png"; filename*=UTF-8''A%C3%A7%C3%A3o%20%221%22%20%28rev%29%2A.png`,
  );
});
