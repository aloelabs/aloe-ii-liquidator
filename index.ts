import Web3 from "web3";
import { Log } from "web3-core";
import { Contract } from "web3-eth-contract";
import { AbiItem } from 'web3-utils';
import { BlockHeader } from 'web3-eth';

import marginAccountLensJson from "./abis/MarginAccountLens.json";
import marginAccountJson from "./abis/MarginAccount.json";

import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";

const config: dotenv.DotenvConfigOutput = dotenv.config();
dotenvExpand.expand(config);

const web3: Web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.GOERLI_TESTNET_ENDPOINT!));

const FACTORY_ADDRESS: string = process.env.FACTORY_ADDRESS!;
const LENS_CONTRACT_ADDRESS: string = process.env.LENS_CONTRACT_ADDRESS!;
const CREATE_ACCOUNT_TOPIC_ID: string = process.env.CREATE_ACCOUNT_TOPIC_ID!;
const ACCOUNT_INDEX: number = parseInt(process.env.ACCOUNT_INDEX!);

type Address = string;

const borrowerLensContract: Contract = new web3.eth.Contract(marginAccountLensJson as AbiItem[], LENS_CONTRACT_ADDRESS);

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
            // borrowerLensContract.methods.getAssets(borrowerAddress).call().then();
            // liquidation_candidates.set(borrowerAddress, )
        } else {
            console.error(error);
        }
    })
}

function collect_liquidate(block: number, borrowers: Set<Address>) {
    collect_borrowers(block, borrowers);
    scan(borrowers);
}

function scan(borrowers: Set<Address>) {
    borrowers.forEach(function(borrower) {
        // Instantiate the borrower contract
        const borrowerContract: Contract = new web3.eth.Contract(marginAccountJson as AbiItem[], borrower);

        if (!isSolvent(borrowerContract)) {
            borrowerContract.methods.liquidate().call().error(console.error);
        }
    });
}

function isSolvent(borrowerContract: Contract): boolean {
    // Make an instance of the contract
    let solvencyResult: boolean = false;
    borrowerContract.methods.liquidate().estimateGas(function(error: Error, estimate: Number) {
        if (error) {
            solvencyResult = true;
            return;
        } else {
            solvencyResult = false;
        }
    })
    return solvencyResult;
}

// First step, get a list of all of the liquidation candidates
const ALOE_INITIAL_DEPLOY: number = 2394823;

// Initialize the set of the borrowers and populate it w/ all the current borrower accounts
let borrowers: Set<Address> = new Set<Address>();
setTimeout(() => collect_borrowers(ALOE_INITIAL_DEPLOY, borrowers), 1000);

const TIMEOUT_IN_MILLISECONDS: number = 500;

web3.eth.subscribe("newBlockHeaders").on("data", (block: BlockHeader) => setTimeout(() => collect_liquidate(block.number, borrowers), TIMEOUT_IN_MILLISECONDS));

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