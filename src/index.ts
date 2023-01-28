import Web3 from "web3";
import { Log } from "web3-core";
import { Contract } from "web3-eth-contract";
import { AbiItem } from 'web3-utils';
import { BlockHeader } from 'web3-eth';

import marginAccountJson from "./abis/MarginAccount.json";
import LiquidatorABIJson from "./abis/Liquidator.json";

import SlackHook from "./SlackHook";

import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import winston from "winston";
import TXManager from "./TxManager";

const config: dotenv.DotenvConfigOutput = dotenv.config();
dotenvExpand.expand(config);

const web3: Web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.OPTIMISM_MAINNET_ENDPOINT!));
web3.eth.handleRevert = true;

const FACTORY_ADDRESS: string = process.env.FACTORY_ADDRESS!;
const CREATE_ACCOUNT_TOPIC_ID: string = process.env.CREATE_ACCOUNT_TOPIC_ID!;
const LIQUIDATOR_CONTRACT_ADDRESS: string = process.env.LIQUIDATOR_ADDRESS!;
const LIQUIDATOR_CONTRACT: Contract = new web3.eth.Contract(LiquidatorABIJson as AbiItem[], LIQUIDATOR_CONTRACT_ADDRESS);

const WALLET_ADDRESS = '0xBbc2cd847Bdf10468861DAb854Cd2B2E315e28c8';


// TODO: It may be beneficial to pass in the web3 instance to the TXManager
// const txManager = new TXManager();
// txManager.init();

// setInterval(() => {
//     txManager.pokePendingTransactions();
// }, 1000);

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
            // Note: for CreateMarginAccount, the account is at index position 2
            // For CreateBorrower, the account will be at a different index
            // topics[0] = CreateMarginAccount method identified
            // topics[1] = pool
            // topics[2] = account (represents the address of the borrower)
            // topics[3] = owner

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
    const promise: Promise<void[]> = Promise.all(borrowers.map(async(borrower) => {
        // winston.log('info', `Borrower: ${borrower}`);

        const solvent: boolean = await isSolvent(borrower);
        if (!solvent) {
            // TODO: We probably don't actually want to log this here, at least not at "info" level (since that'll send it to Slack every time).
            //       It gets called repeatedly until the borrower is actually liquidated. We really only want to send a notifiction when it's
            //       first added to the queue, and when it either succeeds/fails/retries. Not on every scan.
            winston.log('info', `🧜 Sending \`${borrower}\` to transaction manager for liquidation!`);
            // txManager.addLiquidatableAccount(borrower);
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
            winston.log('error', `WARNING: Received estimation error other than "Aloe: healthy" *${msg}*`);
        }
        return true; 
    }
}

// First step, get a list of all of the liquidation candidates
const ALOE_INITIAL_DEPLOY: number = 0;

// Initialize the set of the borrowers and populate it w/ all the current borrower accounts
let borrowers: Address[] = [];
collect_borrowers(ALOE_INITIAL_DEPLOY, borrowers);

const TIMEOUT_IN_MILLISECONDS: number = 500;

web3.eth.subscribe("newBlockHeaders").on("data", (block: BlockHeader) => {
    if (block.number % Number(process.env.SCAN_EVERY_N_BLOCKS) === 0) {
        winston.log('debug', `Received block ${block.number} :: ${block.timestamp}`);
        winston.log('debug', `Scanning borrowers...`);
        scan(borrowers);
    }

    if (block.number % Number(process.env.REPORT_EVERY_N_BLOCKS) === 0) {
        winston.log('info', `Tracking ${
            borrowers.length
        } borrowers. Current block is ${Date.now() / 1000 - Number(block.timestamp)} seconds old`);
    }
}).on("error", () => {
    winston.log('error', 'WARNING: Block header subscription failed');
});

process.on("SIGINT", () => {
    console.log("Caught an interrupt signal");
    // Not sure unsubscribe works
    web3.eth.clearSubscriptions((error: Error, result: boolean) => {
        if (error) {
            console.error(error);
            process.exit(1);
        }
        process.exit(0);
    });
});
