import { fork } from "child_process";
import { arbitrum, base, mainnet, optimism } from "viem/chains";
import * as Sentry from "@sentry/node";

console.log("Starting Liquidator");
if (
  process.env.SENTRY_DSN0 !== undefined &&
  process.env.SENTRY_DSN1 !== undefined &&
  process.env.SENTRY_DSN2 !== undefined
) {
  console.log("Configuring Sentry");
  Sentry.init({
    dsn: `https://${process.env.SENTRY_DSN0}@${process.env.SENTRY_DSN1}.ingest.sentry.io/${process.env.SENTRY_DSN2}`,
    sampleRate: 0.1,
    enabled:
      process.env.SENTRY_DSN0 !== undefined &&
      process.env.SENTRY_DSN1 !== undefined &&
      process.env.SENTRY_DSN2 !== undefined,
    autoSessionTracking: false,
    release: process.env.GIT_COMMIT_SHA || undefined,
  });
}

const chains = [mainnet.id, optimism.id, arbitrum.id, base.id];

chains.forEach((chain) => {
  const child = fork("lib/example.js", ["--chain", chain.toFixed(0)], {});
  child.on("spawn", () => console.log(`Forked process for chain ${chain}`));
  child.on("error", (err) => Sentry.captureException(err, { tags: { chain } }));
  // TODO: handle errors and exits
});
