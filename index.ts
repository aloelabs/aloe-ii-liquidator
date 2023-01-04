import Web3 from "web3";
import { Log } from "web3-core";
import { Contract } from "web3-eth-contract";
import { AbiItem } from 'web3-utils';
import { BlockHeader } from 'web3-eth';

import marginAccountLensJson from "./abis/MarginAccountLens.json";
import marginAccountJson from "./abis/MarginAccount.json";

import SlackHook from "./SlackHook";

import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import winston from "winston";

const config: dotenv.DotenvConfigOutput = dotenv.config();
dotenvExpand.expand(config);

const web3: Web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.GOERLI_TESTNET_ENDPOINT!));

const FACTORY_ADDRESS: string = process.env.FACTORY_ADDRESS!;
const CREATE_ACCOUNT_TOPIC_ID: string = process.env.CREATE_ACCOUNT_TOPIC_ID!;
const ACCOUNT_INDEX: number = parseInt(process.env.ACCOUNT_INDEX!);

// configure winston
winston.configure({
    format: winston.format.combine(winston.format.splat(), winston.format.simple()),
    transports: [
        new winston.transports.Console({ handleExceptions: true }),
        new winston.transports.File({
        level: 'debug',
        filename: 'liuqidation-bot-debug.log',
        maxsize: 100000,
        }),
        new SlackHook(process.env.SLACK_WEBHOOK!, { level: 'info' }),
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

function collect_borrowers(block: number, borrowers: Set<Address>) {
    web3.eth.subscribe('logs', {
        address: FACTORY_ADDRESS,
        topics: [CREATE_ACCOUNT_TOPIC_ID],
        fromBlock: block
    }, function(error: Error, result: Log) {
        if (!error) {
            console.log(result);
            const topics: string[] = result["topics"]
            // Note: for CreateMarginAccount, the account is at index position 2
            // For CreateBorrower, the account will be at a different index
            // topics[0] = CreateMarginAccount method identified
            // topics[1] = pool
            // topics[2] = account (represents the address of the borrower)
            // topics[3] = owner
            const borrowerAddress: Address = format_address(topics[ACCOUNT_INDEX]);
            // Now we need to get the the financial details of the Borrower
            borrowers.add(borrowerAddress);
        } else {
            winston.log("error", `Error when collecting borrowers: ${error}`);
        }
    })
}

function scan(borrowers: Set<Address>): void {
    const promise: Promise<void[]> = Promise.all([...borrowers].map(async(borrower) => {
        const borrowerContract: Contract = new web3.eth.Contract(marginAccountJson as AbiItem[], borrower);
        const solvent: boolean = await isSolvent(borrowerContract);
        if (!solvent) {
            borrowerContract.methods.liquidate().call().error(console.error);
            winston.log('debug', `🔵 *Assumed ownership of* ${borrower}`);
            // Actual liquidation logic here
            // winston.log('debug', `🟢 *Liquidated borrower* ${borrower}`);
        }
    }))
    promise.catch(error => console.error(error));
}

async function isSolvent(borrowerContract: Contract): Promise<boolean> {
    try {
        await borrowerContract.methods.liquidate().estimateGas();
        return true;
    } catch (e) {
        winston.log("error", `Error on solvency check: ${e}`);
        return false;
    }
}

// First step, get a list of all of the liquidation candidates
const ALOE_INITIAL_DEPLOY: number = 2394823;

// Initialize the set of the borrowers and populate it w/ all the current borrower accounts
let borrowers: Set<Address> = new Set<Address>();
collect_borrowers(ALOE_INITIAL_DEPLOY, borrowers);

const TIMEOUT_IN_MILLISECONDS: number = 500;

web3.eth.subscribe("newBlockHeaders").on("data", (block: BlockHeader) => setTimeout(() => scan(borrowers), TIMEOUT_IN_MILLISECONDS));

process.on("SIGINT", () => {
    console.log("Caught an interrupt signal");
    // Not sure unsubscribe works
    web3.eth.clearSubscriptions((error: Error, result: boolean) => {
        if (error) {
            console.error(error);
            process.exit(1);
        }
    });
    process.exit(0);
})