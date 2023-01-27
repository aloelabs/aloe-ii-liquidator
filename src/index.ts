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
const ACCOUNT_INDEX: number = parseInt(process.env.ACCOUNT_INDEX!);
const LIQUIDATOR_CONTRACT_ADDRESS: string = process.env.LIQUIDATOR_ADDRESS!;
const LIQUIDATOR_CONTRACT: Contract = new web3.eth.Contract(LiquidatorABIJson as AbiItem[], LIQUIDATOR_CONTRACT_ADDRESS);


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
        new winston.transports.Console({ handleExceptions: true }),
        new winston.transports.File({
        level: 'debug',
        filename: 'liquidation-bot-debug.log',
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

function collect_borrowers(block: number, borrowers: Address[]) {
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

            const borrowerAddress: Address = format_address(result.data);
            console.log("Borrower Address: ", borrowerAddress);
            // Now we need to get the the financial details of the Borrower
            if (!borrowers.includes(borrowerAddress)) borrowers.push(borrowerAddress);
        } else {
            winston.log("error", `Error when collecting borrowers: ${error}`);
        }
    })
}

function scan(borrowers: Address[]): void {
    const promise: Promise<void[]> = Promise.all(borrowers.map(async(borrower) => {
        const borrowerContract: Contract = new web3.eth.Contract(marginAccountJson as AbiItem[], borrower);
        console.log("Borrower: ", borrower);
        const solvent: boolean = await isSolvent(borrower);
        if (!solvent) {
            winston.log('debug', `🔵 *Assumed ownership of* ${borrower}`);
            // txManager.addLiquidatableAccount(borrower);
            // Actual liquidation logic here
            // winston.log('debug', `🟢 *Liquidated borrower* ${borrower}`);
        }
    }))
    promise.catch(error => console.error(error));
}

async function isSolvent(borrower: string): Promise<boolean> {
    const borrowerContract: Contract = new web3.eth.Contract(marginAccountJson as AbiItem[], borrower);
    try {
        console.log("Checking solvency or something");
        
        // const gasEstimate: number = await borrowerContract.methods.warn().estimateGas({gasLimit: 3_000_000})
        const gasEstimate: number = await borrowerContract.methods.liquidate("0x7BFAAC3EEBe085f91E440E9Fc62394112b533da4", "0x0", 1).estimateGas({gasLimit:3_000_000})
        console.log("liquidate gasEstimate", gasEstimate)
        console.log("Borrower insolvent, liquidate called.")
        return false;
    } catch (e) {
        console.log("Error when optimisitcally calling liqudiate", e, borrower)
        try {
            const gasEstimate: number = await borrowerContract.methods.warn().estimateGas({gasLimit:3_000_000})
            console.log("warn gasEstimate", gasEstimate)
            console.log("Borrower insolvent, warn called.")
            return false
        } catch(e) {
            console.log("Error when calling warn", e, borrower)
            return false;
        }  
    }
}

// First step, get a list of all of the liquidation candidates
const ALOE_INITIAL_DEPLOY: number = 2394823;

// Initialize the set of the borrowers and populate it w/ all the current borrower accounts
let borrowers: Address[] = [];
collect_borrowers(ALOE_INITIAL_DEPLOY, borrowers);

const TIMEOUT_IN_MILLISECONDS: number = 500;

web3.eth.subscribe("newBlockHeaders").on("data", (block: BlockHeader) => {
    if (block.number % 10 === 0) {
        console.log('test');
        scan(borrowers);
    }
}).on("error", () => {
    winston.log("error", "Error when subscribing to new blocks");
});

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