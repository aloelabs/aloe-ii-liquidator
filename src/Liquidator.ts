import { Address, PublicClient, WatchContractEventReturnType, GetContractReturnType } from 'viem';

import { Config, AloeChainConfig } from "./config/config";

import { getBorrowerContract, setupViemFor } from "./Contracts";
import { type ExtractAbiEventNames } from 'abitype'

import { factoryAbi } from "./abis/Factory";

const HEALTH_BASELINE = 1000000000000000000n
const WARN_TIME_MASK = 208n
const DEFAULT_WARN_TIME = 0n
const INITIAL_DEPLOY = 0n
const DEFAULT_LIQUIDATION_WAIT_TIME = 10_000n

// function initializeLiquidators(config: Config): Liquidator[] {
//   let liquidators: Liquidator[] = []
//   for (const aloeChainConfig of config.chainConfigs) {
//     const liquidator = new Liquidator(
//       aloeChainConfig,
//       config,
//     )
//   }
//   return liquidators
// }

async function start(config: Config): Promise<WatchContractEventReturnType[]> {
  let unwatchFns: WatchContractEventReturnType[] = []
  for (const aloeChainConfig of config.chainConfigs) {
    // We don't want one chain to take down the whole liquidator
    const { client, factory, borrowerLens } = setupViemFor(aloeChainConfig, "0x0")
    // Collect borrowers
    let borrowers: Address[] = await getBorrowers(factory, INITIAL_DEPLOY)

    // Setup a watch for new borrowers as well and add them to the list
    unwatchFns.push(
      factory.watchEvent.CreateBorrower(
        { pool: undefined },
        {
          strict: true,
          poll: true,
          pollingInterval: 10_000,
          async onLogs(logs) {
            console.log(`Tracking ${logs.length} new borrowers`);
            borrowers.push(
              ...Array.from(new Set(logs.map((log) => log.args.account!)).values())
            );
          },
        }
      )
    );

    unwatchFns.push(
      client.public.watchBlockNumber({
        onBlockNumber(blockNumber) {
          console.log(`Saw block ${blockNumber}`);
    
          borrowers.forEach(async (borrower) => {
            try {
              const [healthA, healthB] = await borrowerLens.read.getHealth([
                borrower,
              ]);
              const health = healthA < healthB ? healthA : healthB;

              if (health > HEALTH_BASELINE) return;

              const slot0 = await getSlot0(borrower, client.public as PublicClient)

              if (!canWarn(slot0)) {
                return
              }

              warnBorrower(borrower, client.public as PublicClient)

              const waitTime = config.timeToWaitBeforeLiquidation || 10_000
              const timeUntilLiquidation = computeTimeUntilLiquidation(slot0, waitTime)

              
              // Compute the time left in the auction
              setTimeout(() => { console.log(`Would liquidate borrower with address: ${borrower}`) }, Number(timeUntilLiquidation))
            } catch (e) {
              console.error(e);
            }
          });
        },
        poll: true,
        pollingInterval: 60_000,
      })
    );
  }
  return unwatchFns
}

export async function getBorrowers(factory: GetContractReturnType<typeof factoryAbi, PublicClient, `0x${string}`, ExtractAbiEventNames<typeof factoryAbi>>, blockNumber: bigint): Promise<Address[]> {
  let borrowers: Address[] = []
  const createBorrowerEvents = await factory.getEvents.CreateBorrower({ pool: undefined }, { strict: true, fromBlock: blockNumber })
  console.log(`Found ${createBorrowerEvents.length} existing borrowers`);
  
  for (const event of createBorrowerEvents) {
    if (event.args.account !== undefined) {
      borrowers.push(event.args.account)
    }
  }
  return borrowers
}

export async function getSlot0(borrower: Address, client: PublicClient) {
  const contract = getBorrowerContract(borrower, client)
  const slot0 = await contract.read.slot0()
  return slot0
}

export function canWarn(slot0: bigint): boolean {
  // If a borrower has already been warned, then the warn time will not be 0
  const warnTime = (slot0 >> WARN_TIME_MASK) & 0b011111111111111111111111111111111111111111111111n
  return warnTime == DEFAULT_WARN_TIME
}

async function warnBorrower(borrower: Address, client: PublicClient) {
  const contract = getBorrowerContract(borrower, client)
  try {
    const oracleSeed = 1n << 32n
    console.log("Assuming warn got called correctly")
    // const result = await contract.write.warn(oracleSeed)
  } catch (e) {
    console.error(e)
  }
}

// Computes the time until liquidation in milliseconds
function computeTimeUntilLiquidation(slot0: bigint, timeToWaitUntilLiquidation: number): bigint {
  const warnTime = slot0 >> WARN_TIME_MASK;
  const liquidationTime = warnTime + BigInt(timeToWaitUntilLiquidation)
  const currentTime = BigInt(Date.now() / 1000)
  const timeUntilLiquidation = liquidationTime - currentTime
  if (timeToWaitUntilLiquidation < 0n) {
    return 0n
  }
  return timeUntilLiquidation
}
