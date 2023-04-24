import { spawn } from "node:child_process";

import dotenv from "dotenv";
dotenv.config();

import {
  web3WithWebsocketProvider,
  nextStdoutMsg,
  startAnvil,
} from "./sim/Utils";

const alchemy_key = process.env.ALCHEMY_API_KEY;
const anvil = startAnvil({
  forkUrl: `https://opt-mainnet.g.alchemy.com/v2/${alchemy_key}`,
  forkBlockNumber: Number(process.argv[2]), // e.g. 79537361
  blockTime: 5,
  baseFee: 1,
});

nextStdoutMsg(anvil).then(async () => {
  // `await` this to make sure things are good to go
  const web3 = await web3WithWebsocketProvider("ws://localhost:8545");

  // NOTE: We can do all the usual things with this `web3` instance, e.g.:
  /*
  web3.eth.subscribe("newBlockHeaders", (err, res) => {
    console.log(err, res);
  });
  process.on("SIGINT", () => {
    web3.eth.clearSubscriptions(() => {});
  });
  */

  const bot = spawn("node", ["lib/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, SIM: "true" },
    stdio: "pipe",
  });
  bot.stdout.on("data", (data) => console.info(String(data)));
  bot.stderr.on("data", (data) => console.error(String(data)));
  process.on("beforeExit", () => {
    bot.kill("SIGINT");
  });
});
