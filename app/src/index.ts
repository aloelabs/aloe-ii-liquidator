import SlackHook from "./SlackHook";

import dotenv from "dotenv";
import express from "express";
import winston from "winston";
import Liquidator, { HealthCheckResponse } from "./Liquidator";

dotenv.config();
const OPTIMISM_ALCHEMY_URL = `wss://opt-mainnet.g.alchemy.com/v2/${process.env
  .ALCHEMY_API_KEY!}`;
const SLACK_WEBHOOK_URL = `https://hooks.slack.com/services/${process.env
  .SLACK_WEBHOOK0!}/${process.env.SLACK_WEBHOOK1!}/${process.env
  .SLACK_WEBHOOK2!}`;
const port = process.env.PORT || 8080;
const app = express();
const STATUS_OK: number = 200;
const liquidators: Liquidator[] = [
  new Liquidator(OPTIMISM_ALCHEMY_URL, process.env.LIQUIDATOR_ADDRESS!),
];

app.get("/liquidator_liveness_check", (req, res) => {
  res.status(STATUS_OK).send({ status: "ok" });
});

app.get("/liquidator_readiness_check", async (req, res) => {
  await Promise.all(
    liquidators.map(async (liquidator) => {
      const healthCheckResponse: HealthCheckResponse =
        await liquidator.isHealthy();
      if (healthCheckResponse.code !== STATUS_OK) {
        return res
          .status(healthCheckResponse.code)
          .send({ error: healthCheckResponse.message });
      }
    })
  );
  const uptime = process.uptime();
  const responsetime = process.hrtime();
  return res.status(STATUS_OK).send({ status: "ok", uptime, responsetime });
});

winston.configure({
  format: winston.format.combine(
    winston.format.splat(),
    winston.format.simple()
  ),
  transports: [
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
    new SlackHook(SLACK_WEBHOOK_URL, {
      level: "info",
    }),
  ],
  exitOnError: false,
});

function start() {
  for (const liquidator of liquidators) {
    liquidator.start();
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
