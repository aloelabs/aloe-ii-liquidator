import SlackHook from "./SlackHook";

import dotenv from "dotenv";
import express from "express";
import winston from "winston";
import Liquidator, { PROCESS_LIQUIDATABLE_INTERVAL_MS } from "./Liquidator";
import Bottleneck from "bottleneck";
import * as Sentry from "@sentry/node";

dotenv.config();
const OPTIMISM_ALCHEMY_URL = `wss://opt-mainnet.g.alchemy.com/v2/${process.env
  .ALCHEMY_API_KEY!}`;
const ARBITRUM_ALCHEMY_URL = `wss://arb-mainnet.g.alchemy.com/v2/${process.env
  .ALCHEMY_API_KEY!}`;
const SLACK_WEBHOOK_URL = `https://hooks.slack.com/services/${process.env.SLACK_WEBHOOK0}/${process.env.SLACK_WEBHOOK1}/${process.env.SLACK_WEBHOOK2}`;
const port = process.env.PORT || 8080;
const app = express();
const STATUS_OK = 200;
const MS_BETWEEN_REQUESTS = 250;
const limiter = new Bottleneck({
  minTime: MS_BETWEEN_REQUESTS,
});
const LIQUIDATOR_ADDRESS = process.env.LIQUIDATOR_ADDRESS!;
const liquidators: Liquidator[] = process.env.SIM === 'true'
  ? [new Liquidator("ws://localhost:8545", LIQUIDATOR_ADDRESS, limiter)]
  : [
      new Liquidator(OPTIMISM_ALCHEMY_URL, LIQUIDATOR_ADDRESS, limiter),
      new Liquidator(ARBITRUM_ALCHEMY_URL, LIQUIDATOR_ADDRESS, limiter),
    ];

Sentry.init({
  dsn: `https://${process.env.SENTRY_DSN0}@${process.env.SENTRY_DSN1}.ingest.sentry.io/${process.env.SENTRY_DSN2}`,
  sampleRate: 0.2,
  enabled:
    process.env.SENTRY_DSN0 !== undefined &&
    process.env.SENTRY_DSN1 !== undefined &&
    process.env.SENTRY_DSN2 !== undefined,
  autoSessionTracking: false,
});

app.get("/liquidator_liveness_check", (req, res) => {
  res.status(STATUS_OK).send({ status: "ok" });
});

app.get("/liquidator_readiness_check", async (req, res) => {
  const results = await Promise.all(
    liquidators.map(async (liquidator) => {
      return liquidator.isHealthy();
    })
  );
  const unHealthyLiquidator = results.find(
    (result) => result.code !== STATUS_OK
  );
  if (unHealthyLiquidator !== undefined) {
    return res.status(unHealthyLiquidator.code).send(unHealthyLiquidator);
  } else {
    const uptime = process.uptime();
    const responsetime = process.hrtime();
    return res.status(STATUS_OK).send({ status: "ok", uptime, responsetime });
  }
});

const transportList: winston.transport[] = [
  new winston.transports.Console({
    level: "debug",
    handleExceptions: true,
  }),
  new winston.transports.File({
    level: "debug",
    filename: "liquidation-bot-debug.log",
    maxFiles: 1,
    maxsize: 100000,
  }),
];

if (
  "SLACK_WEBHOOK0" in process.env &&
  "SLACK_WEBHOOK1" in process.env &&
  "SLACK_WEBHOOK2" in process.env
) {
  transportList.push(
    new SlackHook(SLACK_WEBHOOK_URL, {
      level: "info",
    })
  );
}

winston.configure({
  format: winston.format.combine(
    winston.format.splat(),
    winston.format.simple()
  ),
  transports: transportList,
  exitOnError: false,
});

async function start() {
  const delayBetweenStarts =
    PROCESS_LIQUIDATABLE_INTERVAL_MS / liquidators.length;
  for (const liquidator of liquidators) {
    liquidator.start();
    // We want to stagger the start of each liquidator so that we can spread
    // out their requests.
    await new Promise((resolve) => setTimeout(resolve, delayBetweenStarts));
  }
}

start();

const server = app.listen(port, () => {
  console.log(`Liquidation bot listening on port ${port}`);
});

process.on("SIGINT", () => {
  console.log("Caught a SIGINT signal");
  liquidators.forEach((liquidator) => {
    liquidator.stop();
  });
  server.close();
  console.log("Exiting...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Caught a terminate signal");
  liquidators.forEach((liquidator) => {
    liquidator.stop();
  });
  server.close();
  console.log("Exiting...");
  process.exit(0);
});
