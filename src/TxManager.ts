import Web3 from "web3";

import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import winston from "winston";
import { TransactionConfig, TransactionReceipt } from "web3-eth"
import { Contract } from "web3-eth-contract";
import { AbiItem } from 'web3-utils';
import liquidatorABIJson from "../abis/MarginAccountLens.json";

const config: dotenv.DotenvConfigOutput = dotenv.config();
dotenvExpand.expand(config);

const web3: Web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.GOERLI_TESTNET_ENDPOINT!));

const LIQUIDATOR_CONTRACT: Contract = new web3.eth.Contract(liquidatorABIJson as AbiItem[]);

const MAX_RETRIES_ALLOWED: number = 5;
const GAS_INCREASE_NUMBER: number = 1.10;
const MAX_PENDING_TIME_IN_SECONDS: number = 30;

type LiquidationTxInfo = {
    borrower: string;
    nonce: number;
    gasPrice: string;
    timeSent: number;
    retries: number;
}

// TODO: get Liquidator contract address after deploying contract
const LIQUIDATOR_CONTRACT_ADDRESS: string = process.env.LIQUIDATOR_ADDRESS!

class TxManager {

    private queue: string[];
    private currentNonce: number = 0;
    private address: string = "";

    private gasPriceMaximum: string = "2000000";
    private pendingTransactions: Map<string, LiquidationTxInfo>;

    constructor() {
        this.queue = [];
        this.pendingTransactions = new Map<string, LiquidationTxInfo>();
    }

    public async init(): Promise<void> {
        const { address } = web3.eth.accounts.create();
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
            let liquidationTxInfo: LiquidationTxInfo | undefined = this.pendingTransactions.get(borrower)
            if (liquidationTxInfo == undefined) {
                // Only want to increase currentNonce if we're about to do a new liquidation
                this.currentNonce++;
                const currentGasPrice: string = await web3.eth.getGasPrice();
                liquidationTxInfo = {
                    borrower: borrower,
                    nonce: this.currentNonce,
                    gasPrice: Math.min(parseInt(currentGasPrice), parseInt(this.gasPriceMaximum)).toString(),
                    timeSent: new Date().getTime(),
                    retries: 0
                }
            } else {
                if (parseInt(liquidationTxInfo.gasPrice) * GAS_INCREASE_NUMBER <= parseInt(this.gasPriceMaximum)) {
                    const newGasPrice: number = parseInt(liquidationTxInfo.gasPrice) * GAS_INCREASE_NUMBER
                    liquidationTxInfo.gasPrice = newGasPrice.toString();
                }

                liquidationTxInfo["retries"]++;
                liquidationTxInfo["timeSent"] = new Date().getTime();
            }
            if (liquidationTxInfo["retries"] > MAX_RETRIES_ALLOWED) {
                winston.log("debug", `Exceeded maximum amount of retries when attempting to liquidate borrower: ${borrower}`);
                continue;
            }
            const transactionConfig: TransactionConfig = {
                from: this.address,
                to: LIQUIDATOR_CONTRACT_ADDRESS,
                gasPrice: liquidationTxInfo["gasPrice"],
                gas: this.gasPriceMaximum,
                nonce: liquidationTxInfo["nonce"],
                data: LIQUIDATOR_CONTRACT.methods.liquidate(borrower).encodeABI()
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
        this.pendingTransactions.forEach((liquidationInfo: LiquidationTxInfo, borrower: string) => {
            const currentTime: number = new Date().getTime();
            // Check if 30 seconds has passed
            const elapsedTimeInSeconds: number = (currentTime - liquidationInfo["timeSent"]) / 1000
            if (elapsedTimeInSeconds > MAX_PENDING_TIME_IN_SECONDS) {
                this.queue.push(borrower);
            }
        })
    }
    
}