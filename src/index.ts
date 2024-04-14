import { fork } from "child_process";
import express from "express";
import * as Sentry from "@sentry/node";
import { arbitrum, base, mainnet, optimism } from "viem/chains";

const port = process.env.PORT || 8080;
const app = express();

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
    tracesSampleRate: 1,
    enabled:
      process.env.SENTRY_DSN0 !== undefined &&
      process.env.SENTRY_DSN1 !== undefined &&
      process.env.SENTRY_DSN2 !== undefined,
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

app.get("/liquidator_readiness_check", (req, res) => {
  res.send("OK");
});

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running on port ${port}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down");
  shutdown();
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down");
  shutdown();
});
