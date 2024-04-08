import { arbitrum, base, mainnet, optimism } from 'viem/chains';

export const FACTORY_ADDRESS = '0x000000009efdB26b970bCc0085E126C9dfc16ee8';

export const BORROWER_LENS_ADDRESS = '0x267Fa142FA270F39738443b914FB7d3F95462451';

export const LIQUIDATOR_ADDRESS = '0xe20fcDBC99fcfaCfEb319CC4536294Bd13d350A4';

export const aloeChains = [mainnet, optimism, arbitrum, base];

export const CHAIN_ID_TO_ALCHEMY_URL_PREFIX: { [chainId: number]: string } = {
  [mainnet.id]: 'eth-mainnet',
  [optimism.id]: 'opt-mainnet',
  [arbitrum.id]: 'arb-mainnet',
  [base.id]: 'base-mainnet',
};
