import { Address, WatchContractEventReturnType, extractChain } from "viem";
import { aloeChains } from "./Constants";
import { setupViemFor } from "./Contracts";

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

let borrowers: Address[] = [];

factory.getEvents
  .CreateBorrower({ pool: undefined }, { strict: true, fromBlock: 0n })
  .then((createBorrowerEvents) => {
    console.log(`Found ${createBorrowerEvents.length} existing borrowers`);
    borrowers.push(
      ...(createBorrowerEvents
        .filter((ev) => ev.args.account !== undefined)
        .map((ev) => ev.args.account) as Address[])
    );
  });

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

          console.log(borrower, health);
          if (health > 1000000000000000000n) return;

          // liquidator.simulate.liquidate
          // liquidator.estimateGas.liquidate
          // liquidator.write.liquidate([borrower, data, 1n], {
          //   // TODO: additional args like gasPrice and gasLimit
          // });
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
