import Web3 from "web3";

import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import winston from "winston";
import { TransactionConfig, TransactionReceipt } from "web3-eth"
const config: dotenv.DotenvConfigOutput = dotenv.config();
dotenvExpand.expand(config);

const web3: Web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.GOERLI_TESTNET_ENDPOINT!));

const MAX_RETRIES_ALLOWED: number = 5;
const GAS_INCREASE_NUMBER: number = 1.10;

type TxInfo = {
    borrower: string;
    nonce: number;
    gas: number;
    timeSent: number;
    retries: number;
}

// TODO: get Liquidator contract address after deploying contract
const LIQUIDATOR_CONTRACT_ADDRESS: string = "0x0"

class TXManager {

    private queue: string[];
    private currentNonce: number = 0;
    private address: string = "";

    private gasPriceMinimum: number = 0;
    private gasPriceMaximum: number = 0;
    private pendingTransactions: Map<string, TxInfo>;

    constructor() {
        this.queue = [];
        this.pendingTransactions = new Map<string, TxInfo>();
    }

    public async init(): Promise<void> {
        const { address } = await web3.eth.accounts.create();
        this.currentNonce = await web3.eth.getTransactionCount(address);
        this.address = address;
    }

    public addLiquidatableAccount(address: string) {
        this.queue.push(address);
    }

    public async processLiquidatableCandidates() {
        for (let i = 0; i < this.queue.length; i++) {
            const borrower: string = this.queue.shift()!
            // Check the map to see if we already have a transaction info for this borrower
            let liquidationInfo: TxInfo | undefined = this.pendingTransactions.get(borrower)
            if (liquidationInfo == undefined) {
                // Only want to increase currentNonce if we're about to do a new liquidation
                this.currentNonce++;
                liquidationInfo = {
                    borrower: borrower,
                    nonce: this.currentNonce,
                    gas: this.gasPriceMinimum,
                    timeSent: new Date().getTime(),
                    retries: 0
                }
            } else {
                liquidationInfo["gas"] = liquidationInfo["gas"] * GAS_INCREASE_NUMBER > this.gasPriceMaximum ? liquidationInfo["gas"] * GAS_INCREASE_NUMBER : this.gasPriceMaximum;
                liquidationInfo["retries"]++;
                liquidationInfo["timeSent"] = new Date().getTime();
            }
            if (liquidationInfo["retries"] > MAX_RETRIES_ALLOWED) {
                winston.log("debug", `Exceeded maximum amount of retries when attempting to liquidate borrower: ${borrower}`);
                continue;
            }
            const transactionConfig: TransactionConfig = {
                from: this.address,
                to: LIQUIDATOR_CONTRACT_ADDRESS,
                gas: liquidationInfo["gas"],
                nonce: liquidationInfo["nonce"],
                data: borrower
            }

            web3.eth.sendTransaction(transactionConfig)
                .on("receipt", async (receipt) => {
                    if (receipt.status) {
                        winston.log("info", `Liquidation successful for borrower: ${borrower}`);
                    } else {
                        const reason: string = await this.getRevertReason(receipt);
                        if (reason.localeCompare("") == 0) {
                            winston.log("error", `EVM revert reason blank when liquidating borrower: ${borrower}`)
                        }
                        switch(reason) {// Used a switch b/c there might be custom logic for other revert codes
                            case "Aloe: healthy":
                                this.pendingTransactions.delete(borrower);
                                break;
                            default:
                                this.queue.push(borrower);   
                        }
                    }
                })
                .on("error", (error: Error) => {
                    winston.log("error", `Received error for borrower: ${borrower} with message: ${error.message}`)
                    this.addLiquidatableAccount(borrower);
                });
        }
    }

    // https://ethereum.stackexchange.com/questions/84545/how-to-get-reason-revert-using-web3-eth-call
    public async getRevertReason(txReceipt: TransactionReceipt): Promise<string> {
        var result: string = await web3.eth.call(txReceipt, txReceipt.blockNumber);

        result = result.startsWith('0x') ? result : `0x${result}`

        let reason: string = "";
        if (result && result.substring(138)) {
          reason = web3.utils.toAscii(result.substring(138))
        }
        return reason
    }

    public pokePendingTransactions() {
        // For transactions that have been pending longer than 30 seconds, add them to the queue
        this.pendingTransactions.forEach((liquidationInfo: TxInfo, borrower: string) => {
            const currentTime: number = new Date().getTime();
            // Check if 30 seconds has passed
            const elapsedTimeInSeconds: number = (currentTime - liquidationInfo["timeSent"]) / 1000
            if (elapsedTimeInSeconds > 30) {
                this.queue.push(borrower);
            }
        })
    }
    
}