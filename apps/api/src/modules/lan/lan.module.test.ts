import { APP_CONFIG } from '@latex-studio/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { USER_REPOSITORY } from '../users/domain/user.repository';
import { FakeUsers } from '../users/testing/fake-user.repository';
import { LanService } from './application/lan.service';
import { LanTokenService } from './application/lan-token.service';
import { LAN_REPOSITORY } from './domain/lan.repository';
import { FakeLan } from './testing/fake-lan.repository';

// Guards the DI wiring: a type-only import or a missing @Inject on a concrete-class param makes Nest
// fail to resolve LanService at boot, which the positional unit tests cannot catch.
describe('LanModule DI', () => {
  it('resolves LanService with its injected dependencies', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LanService,
        LanTokenService,
        { provide: LAN_REPOSITORY, useClass: FakeLan },
        { provide: USER_REPOSITORY, useClass: FakeUsers },
        { provide: APP_CONFIG, useValue: { LAN_SHARE: false, LAN_SECRET: undefined } },
      ],
    }).compile();
    expect(moduleRef.get(LanService)).toBeInstanceOf(LanService);
  });
});
