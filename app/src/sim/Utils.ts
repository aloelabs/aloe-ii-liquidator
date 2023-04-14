import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import Web3 from "web3";
import winston from "winston";

function createLogger(filename: string) {
  return winston.createLogger({
    level: "info",
    format: winston.format.simple(),
    transports: [
      new winston.transports.File({
        filename: filename,
        level: "debug",
      }),
    ],
    exitOnError: false,
  });
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function nextStdoutMsg(proc: ChildProcessWithoutNullStreams) {
  return new Promise<void>((resolve) => {
    proc.stdout.once("data", (_) => resolve());
  });
}

export type AnvilOptions = {
  /**
   * RPC URL from which to pull real chain state
   */
  forkUrl?: string;
  /**
   * Block number at which to fork away from real RPC state
   */
  forkBlockNumber?: number;
  /**
   * Time between mined blocks in seconds, e.g. `2` would mean a fake block is mined every other second.
   */
  blockTime?: number;
  /**
   * Port on localhost for HTTP and WS providers. Default is 8545.
   */
  port?: number;
  /**
   * Path to IPC connection file, e.g. "./anvil.ipc". If unspecified, IPC provider is disabled.
   */
  ipc?: string;
  /**
   * Minimum fee charged for a transaction
   */
  baseFee?: number;
};

export function startAnvil(
  options: AnvilOptions,
  logging = true
): ChildProcessWithoutNullStreams {
  const argPairs = Object.entries(options);
  const args: string[] = [];

  for (const argPair of argPairs) {
    // Split argPair[0] string at every capital letter
    const name = argPair[0]
      .split(/(?=[A-Z])/)
      .map((s) => s.toLowerCase())
      .join("-");
    const value = String(argPair[1]);
    args.push(`--${name}`, value);
  }

  console.info("\nStarting anvil with args:");
  console.info(args);
  console.info("");

  const anvil = spawn("anvil", args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "pipe",
  });

  process.on("beforeExit", () => {
    anvil.kill("SIGINT");
  });

  if (logging) {
    const logger = createLogger("anvil-debug.log");
    anvil.stdout.on("data", (data) => logger.info(data));
    anvil.stderr.on("data", (data) => logger.error(data));
  }

  return anvil;
}

export async function web3WithWebsocketProvider(
  url: string,
  connectionAttempts = 5
) {
  for (let i = 0; i < connectionAttempts; i += 1) {
    try {
      const provider = new Web3.providers.WebsocketProvider(url);
      const web3 = new Web3(provider);

      await web3.eth.getBlockNumber();
      return web3;
    } catch (e) {
      console.error(e);
      await sleep(100);
    }
  }
  throw new Error(
    `Couldn't connect to ${url} despite ${connectionAttempts} tries`
  );
}
