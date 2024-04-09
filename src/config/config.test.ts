import { expect, test } from '@jest/globals';

import { readConfig } from './config';
import { validConfig, invalidValueConfig } from './testConfigs';

test('valid config parsed correctly', () => {
  const parsed = readConfig(validConfig);
  const parsedConfig = {
    chainConfigs: [
      {
        chainName: 'optimism',
        chainNumber: 10,
        factory: '0x95110C9806833d3D3C250112fac73c5A6f631E80',
        borrowerLens: '0x8A15bfEBff7BF9ffaBBeAe49112Dc2E6C4E73Eaf',
        borrower: '0x8A15bfEBff7BF9ffaBBeAe49112Dc2E6C4E73Eaf',
      },
    ],
    multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11',
    createAccountTopicID: '0x1ff0a9a76572c6e0f2f781872c1e45b4bab3a0d90df274ebf884b4c11e3068f4',
    initialDeploy: 0,
    pollingInterval: 45000,
    processLiquidatableInterval: 15000,
    heartbeatInterval: 15000,
    heartbeatTimeout: 10000,
    clientKeepAliveTimeout: 60000,
    sanityCheckInterval: 600000,
    reconnectDelay: 5000,
    reconnectMaxAttemmpts: 5,
    errorThreshold: 5,
    restartTimeout: 259200000,
  };
  expect(parsed).toEqual(parsedConfig);
});

test('invalid config throws error', () => {
  expect(() => readConfig(invalidValueConfig)).toThrowError(new Error('Invalid duration provided: garbage'));
});
