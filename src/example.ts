import {
  Address,
  WatchContractEventReturnType,
  encodeAbiParameters,
  extractChain,
  getContract,
  parseAbiItem,
  parseAbiParameters,
} from "viem";
import { aloeChains } from "./Constants";
import { setupViemFor } from "./Contracts";
import { borrowerAbi } from "./abis/Borrower";

const chainId = Number(process.argv[process.argv.indexOf("--chain") + 1]);
const chain = extractChain({
  chains: aloeChains,
  id: chainId as 1 | 10 | 8453 | 42161,
});
const { client, factory, borrowerLens, liquidator } = setupViemFor(
  chain,
  process.env.WALLET_PRIVATE_KEY! as `0x${string}`
);

const unwatchFns: WatchContractEventReturnType[] = [];

type Borrower = { address: Address; hasBorrows: boolean };
let borrowers = new Map<Address, Borrower>();

// First, collect all borrowers that have been created in the past
factory.getEvents
  .CreateBorrower({ pool: undefined }, { strict: true, fromBlock: 0n })
  .then((createBorrowerEvents) => {
    console.log(`Found ${createBorrowerEvents.length} existing borrowers`);
    // NOTE: `strict: true` above means that ! operator is okay
    createBorrowerEvents.forEach((ev) =>
      borrowers.set(ev.args.account!, {
        address: ev.args.account!,
        hasBorrows: true, // to start, assume they have borrows
      })
    );
  });

// Next, watch for borrowers being created in the future. In combination with
// the previous block, this will give us a complete list of all borrowers on the chain
unwatchFns.push(
  factory.watchEvent.CreateBorrower(
    { pool: undefined },
    {
      strict: true,
      poll: true,
      pollingInterval: 10_000,
      async onLogs(logs) {
        console.log(`Tracking ${logs.length} new borrowers`);
        // NOTE: `strict: true` above means that ! operator is okay
        new Set(logs.map((log) => log.args.account!)).forEach((account) => {
          borrowers.set(account, {
            address: account,
            hasBorrows: true, // to start, assume they have borrows
          });
        });
      },
    }
  )
);

// Instead of dividing by 0, the BorrowerLens returns 1000000000000000000000n if a borrower has no borrows.
// In that case, we stop polling their health, since it's guaranteed not to change[^1]. To know when to _resume_
// polling, we watch `Borrow` events emitted by the Lenders[^2].
// TODO: [1] Technically someone could have borrows yet force their health to exactly equal that number, in which case
// our liquidator would stop polling prematurely. Need more foolproof special-case return value.
// TODO: [2] Technically we're watching _all_ `Borrow` events here, not just those emitted by Lenders. So someone could
// emit an event that spuriously sets `hasBorrows = true`. Not a big deal since it'll be filtered out again on the next poll.
client.public.watchEvent({
  event: parseAbiItem(
    "event Borrow(address indexed caller, address indexed recipient, uint256 amount, uint256 units)"
  ),
  strict: true,
  poll: true,
  pollingInterval: 10_000,
  onLogs(logs) {
    logs.forEach((log) => {
      // NOTE: `strict: true` above means that ! operator is okay
      const caller = log.args.caller!;
      if (borrowers.has(caller) && !borrowers.get(caller)!.hasBorrows) {
        console.log(caller, "started borrowing");
        borrowers.get(caller)!.hasBorrows = true;
      }
    });
  },
});

// Polling for health, ability to warn and liquidate, etc. (runs every 60 seconds)
unwatchFns.push(
  client.public.watchBlockNumber({
    onBlockNumber(blockNumber) {
      console.log(`Saw block ${blockNumber}`);

      borrowers.forEach(async (borrower) => {
        if (!borrower.hasBorrows) return;

        try {
          // NOTE: viem should aggregate these into a multicall behind the scenes
          const [healthA, healthB] = await borrowerLens.read.getHealth([
            borrower.address,
          ]);
          const health = healthA < healthB ? healthA : healthB;

          if (health === 1000000000000000000000n) {
            console.log(borrower.address, health, "(no borrows)");
            borrower.hasBorrows = false;
            return;
          }
          console.log(borrower.address, health);

          const [canWarn, [canLiquidate, auctionTime]] = await Promise.all([
            liquidator.read.canWarn([borrower.address]),
            liquidator.read.canLiquidate([borrower.address]),
          ]);

          const borrowerContract = getContract({
            address: borrower.address,
            abi: borrowerAbi,
            client,
          });

          if (canWarn) {
            console.log(borrower.address, "unhealthy; warning now");
            const hash = await borrowerContract.write.warn([0xffffffff]);
            console.log(`--> ${hash}`);
            return;
          }

          if (canLiquidate && auctionTime < 5 * 60) {
            console.log(
              borrower.address,
              "auction started; will liquidate 5 minutes in"
            );
            return;
          }

          if (canLiquidate) {
            console.log(borrower.address, "liquidating now");
            const [pool, token0, token1, lender0, lender1] = await Promise.all([
              borrowerContract.read.UNISWAP_POOL(),
              borrowerContract.read.TOKEN0(),
              borrowerContract.read.TOKEN1(),
              borrowerContract.read.LENDER0(),
              borrowerContract.read.LENDER1(),
            ]);
            const data = encodeAbiParameters(
              parseAbiParameters(
                "address pool, address token0, address token1, address lender0, address lender1, address caller"
              ),
              [
                pool,
                token0,
                token1,
                lender0,
                lender1,
                client.wallet.account.address,
              ]
            );
            const hash = await liquidator.write.liquidate([
              borrower.address,
              data,
              10000n,
              0xffffffff,
            ]);
            console.log(`--> ${hash}`);
            return;
          }
        } catch (e) {
          console.error(e);
        }
      });
    },
    poll: true,
    pollingInterval: 60_000,
  })
);

process.on("exit", () => {
  unwatchFns.forEach((unwatchFn) => unwatchFn());
});

process.on("SIGINT", () => {
  process.exit(2);
});
