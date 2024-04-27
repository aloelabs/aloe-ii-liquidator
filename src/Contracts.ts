import {
  Chain,
  createPublicClient,
  createWalletClient,
  fallback,
  getContract,
  http,
  webSocket,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, base, mainnet, optimism, linea, scroll } from "viem/chains";

import { factoryAbi } from "./abis/Factory";
import {
  CHAIN_ID_TO_ALCHEMY_URL_PREFIX,
  FACTORY_ADDRESS,
  BORROWER_LENS_ADDRESS,
  LIQUIDATOR_ADDRESS,
} from "./Constants";
import "dotenv/config";
import { borrowerLensAbi } from "./abis/BorrowerLens";
import { liquidatorAbi } from "./abis/Liquidator";

function alchemyWssUrlFor(chain: Chain) {
  const prefix = CHAIN_ID_TO_ALCHEMY_URL_PREFIX[chain.id];
  if (!prefix) {
    throw new Error(
      `Alchemy URL prefix undefined for ${chain.name} (id: ${chain.id})`
    );
  }
  return `wss://${prefix}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
}

function getTransportFor(chain: Chain) {
  const config = {
    batch: true,
    retryCount: 5,
    retryDelay: 1000,
  };
  if (chain.id === linea.id) {
    return fallback(
      [
        http("https://rpc.linea.build", config),
        http("https://linea.decubate.com", config),
        http("https://linea.drpc.org", config),
      ],
      {
        retryCount: 5,
        retryDelay: 1000,
      }
    );
  }
  if (chain.id === scroll.id) {
    return fallback(
      [
        http("https://scroll.drpc.org", config),
        http("https://1rpc.io/scroll", config),
        http("https://rpc.ankr.com/scroll", config),
      ],
      {
        retryCount: 5,
        retryDelay: 1000,
      }
    );
  }
  return webSocket(alchemyWssUrlFor(chain), { retryCount: 60 });
}

export function setupViemFor(chain: Chain, privateKey: `0x${string}`) {
  const transport = getTransportFor(chain);
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
    transport,
  });

  const walletClient = createWalletClient({
    cacheTime: 4_000,
    pollingInterval: 10_000,
    chain,
    account: privateKeyToAccount(privateKey),
    transport,
  });

  const client = {
    public: publicClient,
    wallet: walletClient,
  };

  const factory = getContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    client,
  });

  const borrowerLens = getContract({
    address: BORROWER_LENS_ADDRESS,
    abi: borrowerLensAbi,
    client,
  });

  const liquidator = getContract({
    address: LIQUIDATOR_ADDRESS,
    abi: liquidatorAbi,
    client,
  });

  return {
    client,
    factory,
    borrowerLens,
    liquidator,
  };
}
