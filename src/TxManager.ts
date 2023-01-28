import Web3 from "web3";

import { config, DotenvConfigOutput } from "dotenv";
import { expand } from "dotenv-expand";
import { log } from "winston";
import { TransactionConfig, TransactionReceipt } from "web3-eth"
import { Contract } from "web3-eth-contract";
import { AbiItem } from 'web3-utils';
import marginAccountJson from "./abis/MarginAccount.json";
import LiquidatorABIJson from "./abis/Liquidator.json";
import { LiquidationType } from ".";

const customConfig: DotenvConfigOutput = config();
expand(customConfig);

const web3: Web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.OPTIMISM_MAINNET_ENDPOINT!));

// TODO: get Liquidator contract address after deploying contract
const LIQUIDATOR_CONTRACT_ADDRESS: string = process.env.LIQUIDATOR_ADDRESS!;

const LIQUIDATOR_CONTRACT: Contract = new web3.eth.Contract(LiquidatorABIJson as AbiItem[], LIQUIDATOR_CONTRACT_ADDRESS);

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

type CandidateConfig = {
    borrower: string;
    liquidationType: LiquidationType;
}

export default class TXManager {

    private queue: CandidateConfig[];
    private currentNonce: number = 0;
    private address: string = "";

    private gasPriceMaximum: string = "2000000";
    private pendingTransactions: Map<string, LiquidationTxInfo>;
    private borrowersInProgress: string[];

    constructor() {
        this.queue = [];
        this.pendingTransactions = new Map<string, LiquidationTxInfo>();
        this.borrowersInProgress = [];
    }

    public async init(): Promise<void> {
        const account = web3.eth.accounts.privateKeyToAccount(process.env.WALLET_PRIVATE_KEY!);
        const address: string = account.address;
        this.currentNonce = await web3.eth.getTransactionCount(address, "pending");
        this.address = address;
    }

    public addLiquidatableAccount(address: string, liquidationType: LiquidationType, shouldProcess: boolean = true) {
        this.queue.push({borrower: address, liquidationType});
        if (shouldProcess) this.processLiquidatableCandidates();
    }

    public async processLiquidatableCandidates() {
        for (let i = 0; i < this.queue.length; i++) {
            const candidate: CandidateConfig = this.queue.shift()!
            const borrower = candidate.borrower;
            const borrowerContract = new web3.eth.Contract(marginAccountJson as AbiItem[], borrower);
            const liquidationType = candidate.liquidationType;
            // Check the map to see if we already have a transaction info for this borrower
            let liquidationTxInfo: LiquidationTxInfo | undefined = this.pendingTransactions.get(borrower);
            if (liquidationTxInfo === undefined) {
                // Only want to increase currentNonce if we're about to do a new liquidation
                // this.currentNonce++;
                const currentGasPrice: string = await web3.eth.getGasPrice();
                liquidationTxInfo = {
                    borrower: borrower,
                    nonce: this.currentNonce,
                    gasPrice: (Math.min(parseInt(currentGasPrice), parseInt(this.gasPriceMaximum)) * 2).toString(),
                    timeSent: new Date().getTime(),
                    retries: 0
                }
                this.pendingTransactions.set(borrower, liquidationTxInfo);
            } else {
                if (parseInt(liquidationTxInfo.gasPrice) * GAS_INCREASE_NUMBER <= parseInt(this.gasPriceMaximum)) {
                    const newGasPrice: number = parseInt(liquidationTxInfo.gasPrice) * GAS_INCREASE_NUMBER
                    liquidationTxInfo.gasPrice = newGasPrice.toString();
                }

                liquidationTxInfo["retries"]++;
                liquidationTxInfo["timeSent"] = new Date().getTime();
            }
            if (liquidationTxInfo["retries"] > MAX_RETRIES_ALLOWED) {
                log("debug", `Exceeded maximum amount of retries when attempting to liquidate borrower: ${borrower}`);
                continue;
            }

            const transactionCount = await web3.eth.getTransactionCount(this.address, "latest");
            console.log('txnCount', transactionCount);
            const encodedAddress = web3.eth.abi.encodeParameter("address", this.address);
            const methodToCall = liquidationType == LiquidationType.Liquidate ? borrowerContract.methods.liquidate(LIQUIDATOR_CONTRACT_ADDRESS, encodedAddress, 20) : borrowerContract.methods.warn();
            const transactionConfig: TransactionConfig = {
                from: this.address,
                to: borrower,
                gasPrice: liquidationTxInfo["gasPrice"],
                gas: this.gasPriceMaximum,
                nonce: liquidationTxInfo["nonce"],
                data: methodToCall.encodeABI(),
            }

            console.log(transactionConfig);

            const isInProgress: boolean = this.borrowersInProgress.includes(borrower);
            if (!isInProgress) {
                this.borrowersInProgress.push(borrower);
                console.log("Sending transaction");
                console.log(transactionConfig);
                const signedTransaction = await web3.eth.accounts.signTransaction(transactionConfig, process.env.WALLET_PRIVATE_KEY!);
                web3.eth.sendSignedTransaction(signedTransaction.rawTransaction!)
                    .on("receipt", async (receipt) => {
                        if (receipt.status) {
                            log("info", `Liquidation successful for borrower: ${borrower}`);
                            this.pendingTransactions.delete(borrower);
                        } else {
                            const reason: string = await this.getRevertReason(receipt);
                            if (reason.localeCompare("") == 0) {
                                log("error", `EVM revert reason blank when liquidating borrower: ${borrower}`)
                            }
                            switch(reason) {// Used a switch b/c there might be custom logic for other revert codes
                                case "Aloe: healthy":
                                    this.pendingTransactions.delete(borrower);
                                    break;
                                default:
                                    this.queue.push(candidate);   
                            }
                        }
                    })
                    .on("error", (error: Error) => {
                        log("error", `Received error for borrower: ${borrower} with message: ${error.message}`);
                        // remove borrower from borrowersInProgress
                        console.log('liquidation error for borrower', borrower, error.message);
                        this.borrowersInProgress = this.borrowersInProgress.splice(this.borrowersInProgress.indexOf(borrower), 1);
                        this.addLiquidatableAccount(borrower, liquidationType);
                    }).on("sending", () => {
                        console.log("sending");
                    }).on("sent", () => {
                        console.log("sent");
                    }).on("transactionHash", (hash: string) => {
                        console.log("transactionHash", hash);
                    }).on("confirmation", (confirmationNumber: number, receipt: TransactionReceipt) => {
                        console.log("confirmation", confirmationNumber, receipt);
                    });
                }
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
        return reason;
    }

    public pokePendingTransactions() {
        // For transactions that have been pending longer than 30 seconds, add them to the queue
        this.pendingTransactions.forEach((liquidationInfo: LiquidationTxInfo, borrower: string) => {
            const currentTime: number = new Date().getTime();
            // Check if 30 seconds has passed
            const elapsedTimeInSeconds: number = (currentTime - liquidationInfo["timeSent"]) / 1000
            if (elapsedTimeInSeconds > MAX_PENDING_TIME_IN_SECONDS) {
                // this.addLiquidatableAccount(borrower, LiquidationType.None, false);
            }
        })
    }
    
}