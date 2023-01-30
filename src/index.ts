import Web3 from "web3";
import { Log } from "web3-core";
import { Contract } from "web3-eth-contract";
import { AbiItem } from 'web3-utils';

import LiquidatorABIJson from "./abis/Liquidator.json";

import SlackHook from "./SlackHook";

import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import winston from "winston";
import TXManager from "./TxManager";

const config: dotenv.DotenvConfigOutput = dotenv.config();
dotenvExpand.expand(config);

let provider = new Web3.providers.WebsocketProvider(process.env.OPTIMISM_MAINNET_ENDPOINT!, {
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


// TODO: It may be beneficial to pass in the web3 instance to the TXManager
const txManager = new TXManager();
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
        new SlackHook(process.env.SLACK_WEBHOOK!, {
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
                winston.log('info', `Detected new borrower! Adding \`${borrowerAddress}\` to global list (${borrowers.length} total).`);
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
            // Actual liquidation logic here
            // winston.log('debug', `🟢 *Liquidated borrower* ${borrower}`);
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
            // winston.log('error', `WARNING: Received estimation error other than "Aloe: healthy" *${msg}*`);
        }
        return true; 
    }
}

// First step, get a list of all of the liquidation candidates
const ALOE_INITIAL_DEPLOY: number = 0;

// Initialize the set of the borrowers and populate it w/ all the current borrower accounts
let borrowers: Address[] = [];
collect_borrowers(ALOE_INITIAL_DEPLOY, borrowers);

const pollingInterval = setInterval(() => {
    console.log("Scanning borrowers...");
    scan(borrowers);
}, 20_000);

winston.log("info", "🔋 Powering up liquidation bot...");

process.on("SIGINT", () => {
    console.log("Caught an interrupt signal");
    winston.log("info", "🪫 Powering down liquidation bot...");
    clearInterval(pollingInterval);
    // Not sure unsubscribe works
    web3.eth.clearSubscriptions((error: Error, result: boolean) => {
        if (error) {
            console.error(error);
            process.exit(1);
        }
        process.exit(0);
    });
});
