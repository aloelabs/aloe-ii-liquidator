import {
  Chain,
  PublicClient,
  WalletClient,
  createPublicClient,
  createWalletClient,
  getContract,
  webSocket,
  extractChain,
  publicActions,
  walletActions,
  createTestClient,
  http,
} from 'viem';
import { foundry } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

import { factoryAbi } from './abis/Factory';
import { borrowerLensAbi } from './abis/BorrowerLens';
import { erc20Abi } from './abis/ERC20';

import {
  CHAIN_ID_TO_ALCHEMY_URL_PREFIX,
} from './Constants';
import 'dotenv/config';

import { AloeChainConfig } from './config/config';
import { aloeChains } from './Constants';
import { borrowerAbi } from './abis/Borrower';

function alchemyWssUrlFor(chain: Chain) {
  const prefix = CHAIN_ID_TO_ALCHEMY_URL_PREFIX[chain.id];
  if (!prefix) {
    throw new Error(`Alchemy URL prefix undefined for ${chain.name} (id: ${chain.id})`);
  }
  return `wss://${prefix}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
}

export function setupViemFor(config: AloeChainConfig, privateKey: `0x${string}`) {
  const chain = extractChain({
    chains: aloeChains,
    id: config.chainNumber as 1 | 10 | 8453 | 42161,
  });

  const publicClient = createPublicClient({
    batch: {
      multicall: {
        batchSize: 1024,
        wait: 50,
      },
    },
    cacheTime: 4_000,
    pollingInterval: 10_000,
    chain,
    transport: webSocket(alchemyWssUrlFor(chain), { retryCount: 60 }),
  });

  const walletClient: WalletClient = createWalletClient({
    cacheTime: 4_000,
    pollingInterval: 10_000,
    chain,
    account: privateKeyToAccount(privateKey),
    transport: webSocket(alchemyWssUrlFor(chain), { retryCount: 60 }),
  });

  const client = {
    public: publicClient,
    wallet: walletClient,
  };

  const factory = getContract({
    address: config.factory,
    abi: factoryAbi,
    client,
  });

  const borrowerLens = getContract({
    address: config.borrowerLens,
    abi: borrowerLensAbi,
    client,
  });

  return {
    client,
    factory,
    borrowerLens,
  };
}

export function getBorrowerContract(borrower: `0x${string}`, client: PublicClient) {
  return getContract({
    address: borrower,
    abi: borrowerAbi,
    client: client,
  })
}

export function getERC20Contract(token: `0x${string}`, client: PublicClient) {
  return getContract({
    address: token,
    abi: erc20Abi,
    client: client,
  })
}

export function setupViemTestClient(factoryAddress: `0x${string}`, borrowerLensAddress: `0x${string}`) {
  const client = createTestClient({
    chain: foundry,
    mode: 'anvil',
    transport: http(),
  }).extend(publicActions).extend(walletActions);

  const factory = getContract({
    address: factoryAddress,
    abi: factoryAbi,
    client,
  });

  const borrowerLens = getContract({
    address: borrowerLensAddress,
    abi: borrowerLensAbi,
    client,
  });

  return {
    client,
    factory,
    borrowerLens,
  };
}