import { Address } from 'viem';

export const validConfig = {
  chainConfigs: [
    {
      chainName: 'optimism',
      chainNumber: 10,
      factory: `0x95110C9806833d3D3C250112fac73c5A6f631E80` as Address,
      borrowerLens: '0x8A15bfEBff7BF9ffaBBeAe49112Dc2E6C4E73Eaf' as Address,
      borrower: '0x8A15bfEBff7BF9ffaBBeAe49112Dc2E6C4E73Eaf' as Address,
    },
  ],
  multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11' as Address,
  createAccountTopicID: '0x1ff0a9a76572c6e0f2f781872c1e45b4bab3a0d90df274ebf884b4c11e3068f4',
  initialDeploy: 0,
  pollingInterval: '45s',
  processLiquidatableInterval: '15s',
  heartbeatInterval: '15s',
  heartbeatTimeout: '10s',
  clientKeepAliveTimeout: '1m',
  sanityCheckInterval: '10m',
  reconnectDelay: '5000ms',
  reconnectMaxAttemmpts: 5,
  errorThreshold: 5,
  restartTimeout: '72h',
  timeToWaitBeforeLiquidation: '10m',
};

export const invalidValueConfig = {
  chainConfigs: [
    {
      chainName: 'optimism',
      chainNumber: 10,
      factory: '0x95110C9806833d3D3C250112fac73c5A6f631E80' as Address,
      borrowerLens: '0x8A15bfEBff7BF9ffaBBeAe49112Dc2E6C4E73Eaf' as Address,
      borrower: '0x8A15bfEBff7BF9ffaBBeAe49112Dc2E6C4E73Eaf' as Address,
    },
  ],
  multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11' as Address,
  createAccountTopicID: '0x1ff0a9a76572c6e0f2f781872c1e45b4bab3a0d90df274ebf884b4c11e3068f4',
  initialDeploy: 0,
  pollingInterval: 'garbage', // this is the invalid field
  processLiquidatableInterval: '15s',
  heartbeatInterval: '15s',
  heartbeatTimeout: '10s',
  clientKeepAliveTimeout: '1m',
  sanityCheckInterval: '10m',
  reconnectDelay: '5000ms',
  reconnectMaxAttemmpts: 5,
  errorThreshold: 5,
  restartTimeout: '72h',
  timeToWaitBeforeLiquidation: '10m',
};