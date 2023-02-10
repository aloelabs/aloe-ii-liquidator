import Web3 from "web3";
import { Log } from "web3-core";
import { Contract } from "web3-eth-contract";
import { AbiItem } from 'web3-utils';

import LiquidatorABIJson from "./abis/Liquidator.json";

import SlackHook from "./SlackHook";

import dotenv from "dotenv";
import express from "express";
import winston from "winston";
import TXManager from "./TxManager";

dotenv.config();
const POLLING_INTERVAL = 60_000;
const OPTIMISM_ALCHEMY_URL = `wss://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY!}`;
if (process.env.SLACK_WEBHOOK0 === undefined || process.env.SLACK_WEBHOOK1 === undefined || process.env.SLACK_WEBHOOK2 === undefined) {
    console.log("SLACK_WEBHOOK0, SLACK_WEBHOOK1, SLACK_WEBHOOK2 must all be provided to send logs. If you're not sending logs to Slack, comment out the corresponding lines in winston.configure.");
    process.exit(1);
}
const SLACK_WEBHOOK_URL = `https://hooks.slack.com/services/${process.env.SLACK_WEBHOOK0}/${process.env.SLACK_WEBHOOK1}/${process.env.SLACK_WEBHOOK2}`;
const port = process.env.PORT || 8080;
const app = express();
const uniqueId = (Math.random() * 1000000).toFixed(0);
const NOT_READY_CODE: number = 503;
const STATUS_OK: number = 200;

app.get('/liquidator_liveness_check', (req, res) => {
    res.status(STATUS_OK).send({"status": "ok"});
});

app.get('/liquidator_readiness_check', async (req, res) => {
    try {
        const result: boolean = await web3.eth.net.isListening();
        console.log("Is listening?", result);
        if (!result) {
            return res.status(NOT_READY_CODE).send({"error": "unable to listen to peers"})
        }
    } catch (e) {
        const msg: string = (e as Error).message;
        return res.status(NOT_READY_CODE).send({"error": msg}) 
    }
    if (!txManager.isHealthy()) {
        return res.status(NOT_READY_CODE).send({"error": "TXManager Unhealthy"});
    }
    return res.status(STATUS_OK).send({"status": "ok"})
});

let provider = new Web3.providers.WebsocketProvider(OPTIMISM_ALCHEMY_URL, {
    clientConfig: {
        keepalive: true,
        keepaliveInterval: 60000, // ms
    },
    reconnect: {
        auto: true,
        delay: 5000,
        maxAttempts: 5,
        onTimeout: false,
    },
});

let web3: Web3 = new Web3(provider);
web3.eth.handleRevert = true;

const FACTORY_ADDRESS: string = process.env.FACTORY_ADDRESS!;
const CREATE_ACCOUNT_TOPIC_ID: string = process.env.CREATE_ACCOUNT_TOPIC_ID!;
const LIQUIDATOR_CONTRACT_ADDRESS: string = process.env.LIQUIDATOR_ADDRESS!;
const LIQUIDATOR_CONTRACT: Contract = new web3.eth.Contract(LiquidatorABIJson as AbiItem[], LIQUIDATOR_CONTRACT_ADDRESS);

const WALLET_ADDRESS = process.env.WALLET_ADDRESS!;

const txManager = new TXManager(web3);
txManager.init();

// configure winston
winston.configure({
    format: winston.format.combine(winston.format.splat(), winston.format.simple()),
    transports: [
        new winston.transports.Console({
            level: 'debug',
            handleExceptions: true,
        }),
        new winston.transports.File({
            level: 'debug',
            filename: 'liquidation-bot-debug.log',
            maxsize: 100000,
        }),
        new SlackHook(SLACK_WEBHOOK_URL, {
            level: 'info',
        }),
    ],
    exitOnError: false,
});

type Address = string;

function format_address(hexString: string): string {
    // Check that the string starts with '0x'
    let result: string = "0x";
    // Addresses are 40 characters long, but we may have leading zeroes, so we should
    // take the unneeded 0s out
    result = result.concat(hexString.substring(hexString.length - 40));
    return result;
}

function collect_borrowers(block: number, borrowers: Address[]) {
    web3.eth.subscribe('logs', {
        address: FACTORY_ADDRESS,
        topics: [CREATE_ACCOUNT_TOPIC_ID],
        fromBlock: block
    }, function(error: Error, result: Log) {
        if (!error) {
            const borrowerAddress: Address = format_address(result.data);
            if (!borrowers.includes(borrowerAddress)) {
                winston.log('debug', `Detected new borrower! Adding \`${borrowerAddress}\` to global list (${borrowers.length} total).`);
                borrowers.push(borrowerAddress);
            } else {
                winston.log('debug', `Received duplicate creation event for borrower ${borrowerAddress}`);
            }
        } else {
            winston.log("error", `Error when collecting borrowers: ${error}`);
        }
    })
}

function scan(borrowers: Address[]): void {
    // TODO: spread these out over time, so we don't get rate limited
    const promise: Promise<void[]> = Promise.all(borrowers.map(async(borrower) => {
        const solvent: boolean = await isSolvent(borrower);
        console.log("Is solvent?", solvent, borrower);
        if (!solvent) {
            // TODO: We probably don't actually want to log this here, at least not at "info" level (since that'll send it to Slack every time).
            //       It gets called repeatedly until the borrower is actually liquidated. We really only want to send a notifiction when it's
            //       first added to the queue, and when it either succeeds/fails/retries. Not on every scan.
            winston.log('info', `🧜 Sending \`${borrower}\` to transaction manager for liquidation!`);
            console.log("Adding borrower to liquidation queue...", borrower);
            txManager.addLiquidatableAccount(borrower);
        }
    }))
    promise.catch(error => console.error(error));
}

async function isSolvent(borrower: string): Promise<boolean> {
    const shortName = borrower.slice(0, 8);
    try {
        winston.log('debug', `Checking solvency of ${shortName} via gas estimation...`)

        const data = web3.eth.abi.encodeParameter("address", WALLET_ADDRESS);
        console.log("Checking solvency of", borrower, "via gas estimation...", data);
        const estimatedGasLimit: number = await LIQUIDATOR_CONTRACT.methods.liquidate(borrower, data, 1).estimateGas({
            gasLimit: 3_000_000,
        });

        winston.log('debug', `--> Received estimate (${estimatedGasLimit} gas), indicating that ${shortName} can be liquidated`);
        return false;
    } catch (e) {
        const msg = (e as Error).message;

        if (msg.includes('Aloe: healthy')) {
            winston.log('debug', `--> ${shortName} is healthy`);
        } else {
            console.log("WARNING: Received estimation error other than 'Aloe: healthy'", msg);
            console.log("This most likely means that we just warned them and we are waiting to actually liquidate them.")
        }
        return true; 
    }
}

// First, get a list of all of the liquidation candidates
const ALOE_INITIAL_DEPLOY: number = 0;

// Initialize the set of the borrowers and populate it w/ all the current borrower accounts
let borrowers: Address[] = [];
collect_borrowers(ALOE_INITIAL_DEPLOY, borrowers);

const pollingInterval = setInterval(() => {
    console.log("Scanning borrowers...");
    scan(borrowers);
}, POLLING_INTERVAL);

winston.log("info", `🔋 Powering up liquidation bot #${uniqueId}`);

const server = app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});

process.on("SIGINT", () => {
    console.log("Caught an interrupt signal");
    winston.log("info", `🪫 Powering down liquidation bot #${uniqueId}`);
    clearInterval(pollingInterval);
    server.close();
    // Not sure unsubscribe works
    web3.eth.clearSubscriptions((error: Error, result: boolean) => {
        if (error) {
            console.error(error);
            process.exit(1);
        }
        process.exit(0);
    });
});

process.on("SIGTERM", () => {
    console.log("Caught a terminate signal");
    winston.log("info", `🪫 Powering down liquidation bot #${uniqueId}`);
    clearInterval(pollingInterval);
    server.close();
    // Not sure unsubscribe works
    web3.eth.clearSubscriptions((error: Error, result: boolean) => {
        if (error) {
            console.error(error);
            process.exit(1);
        }
        process.exit(0);
    });
});
