import { describe, expect, it } from 'vitest';
import { splitCommitMessage } from './history.service';

describe('splitCommitMessage', () => {
  it('keeps the first line as the subject and the co-authors apart', () => {
    expect(
      splitCommitMessage(
        'Metodologia revisada pelo grupo\n\nCo-authored-by: Ana Souza\nco-authored-by: Bruno Lima <b@x.org>',
      ),
    ).toEqual({
      subject: 'Metodologia revisada pelo grupo',
      coAuthors: ['Ana Souza', 'Bruno Lima'],
    });
    expect(splitCommitMessage('Import')).toEqual({ subject: 'Import', coAuthors: [] });
  });
});
