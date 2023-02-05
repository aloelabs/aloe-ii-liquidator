import Web3 from "web3";

import { config } from "dotenv";
import { log } from "winston";
import { TransactionConfig, TransactionReceipt } from "web3-eth"
import { Contract } from "web3-eth-contract";
import { AbiItem } from 'web3-utils';
import { Account } from 'web3-core'
import LiquidatorABIJson from "./abis/Liquidator.json";

config();

const ETHERSCAN_LINK = "https://optimistic.etherscan.io/tx/";

const LIQUIDATOR_CONTRACT_ADDRESS: string = process.env.LIQUIDATOR_ADDRESS!;

const MAX_RETRIES_ALLOWED: number = 5;
const GAS_INCREASE_NUMBER: number = 1.10;
const MAX_ACCEPTABLE_ERRORS = 1;

type LiquidationTxInfo = {
    borrower: string;
    gasPrice: string;
    timeSent: number;
    retries: number;
}

export default class TXManager {

    private queue: string[];
    private address: string = "";
    private client: Web3;

    private gasPriceMaximum: string = "2000000";
    private pendingTransactions: Map<string, LiquidationTxInfo>;
    private borrowersInProgress: string[];
    private errorCount: number;
    
    private liquidatorContract: Contract;

    constructor(web3Client: Web3) {
        this.client = web3Client;
        this.queue = [];
        this.pendingTransactions = new Map<string, LiquidationTxInfo>();
        this.borrowersInProgress = [];
        this.errorCount = 0;
        this.liquidatorContract = new this.client.eth.Contract(LiquidatorABIJson as AbiItem[], LIQUIDATOR_CONTRACT_ADDRESS);
    }

    public async init(): Promise<void> {
        const account: Account = this.client.eth.accounts.privateKeyToAccount(process.env.WALLET_PRIVATE_KEY!)
        const address: string = account.address;
        this.address = address;
    }

    public addLiquidatableAccount(address: string) {
        this.queue.push(address);
        this.processLiquidatableCandidates();
    }

    private isLiquidationInProgress(borrower: string): boolean {
        return this.borrowersInProgress.includes(borrower);
    }

    public async processLiquidatableCandidates() {
        for (let i = 0; i < this.queue.length; i++) {
            const borrower: string = this.queue.shift()!;
            if (this.isLiquidationInProgress(borrower)) 
                continue;
            // Check the map to see if we already have a transaction info for this borrower
            let liquidationTxInfo: LiquidationTxInfo | undefined = this.pendingTransactions.get(borrower);
            console.log("liquidationTxInfo: ", liquidationTxInfo);
            if (liquidationTxInfo === undefined) {
                console.log("liquidationTxInfo === undefined", liquidationTxInfo);
                const currentGasPrice: string = await this.client.eth.getGasPrice();
                liquidationTxInfo = {
                    borrower: borrower,
                    gasPrice: Math.min(parseInt(currentGasPrice), parseInt(this.gasPriceMaximum)).toString(),
                    timeSent: new Date().getTime(),
                    retries: 0,
                }
                this.pendingTransactions.set(borrower, liquidationTxInfo);
            } else {
                console.log(liquidationTxInfo.gasPrice, liquidationTxInfo);
                if (parseInt(liquidationTxInfo.gasPrice) * GAS_INCREASE_NUMBER <= parseInt(this.gasPriceMaximum)) {
                    const newGasPrice: number = Math.ceil(parseInt(liquidationTxInfo.gasPrice) * GAS_INCREASE_NUMBER);
                    console.log("newGasPrice: ", newGasPrice);
                    liquidationTxInfo.gasPrice = newGasPrice.toString();
                }

                liquidationTxInfo["retries"]++;
                liquidationTxInfo["timeSent"] = new Date().getTime();
            }
            if (liquidationTxInfo["retries"] > MAX_RETRIES_ALLOWED) {
                log("debug", `Exceeded maximum amount of retries when attempting to liquidate borrower: ${borrower}`);
                continue;
            }
            const encodedAddress = this.client.eth.abi.encodeParameter("address", this.address);
            const currentNonce = await this.client.eth.getTransactionCount(this.address, "pending");
            const transactionConfig: TransactionConfig = {
                from: this.address,
                to: LIQUIDATOR_CONTRACT_ADDRESS,
                gasPrice: liquidationTxInfo["gasPrice"],
                gas: this.gasPriceMaximum,
                nonce: currentNonce,
                data: this.liquidatorContract.methods.liquidate(borrower, encodedAddress, 1).encodeABI(),
            }

            console.log("transactionConfig: ", transactionConfig);
            
            // An extra check to make sure we don't send the same transaction twice
            if (this.isLiquidationInProgress(borrower))
                continue;

            this.borrowersInProgress.push(borrower);
            const signedTransaction = await this.client.eth.accounts.signTransaction(transactionConfig, process.env.WALLET_PRIVATE_KEY!);
            this.client.eth.sendSignedTransaction(signedTransaction.rawTransaction!)
                .on("receipt", async (receipt) => {
                    if (receipt.status) {
                        log("info", `💦 Borrower \`${borrower}\` has been liquidated! ${ETHERSCAN_LINK}${receipt.transactionHash}`);
                        this.pendingTransactions.delete(borrower);
                        this.borrowersInProgress = this.borrowersInProgress.filter((value) => value != borrower);
                    } else {
                        const reason: string = await this.getRevertReason(receipt);
                        if (reason.localeCompare("") == 0) {
                            log("error", `EVM revert reason blank when liquidating borrower: ${borrower}`);
                        }
                        switch(reason) {// Used a switch b/c there might be custom logic for other revert codes
                            case "Aloe: healthy":
                                console.log("Aloe: healthy, removing from queue");
                                this.pendingTransactions.delete(borrower);
                                break;
                            default:
                                this.queue.push(borrower);   
                        }
                    }
                })
                .on("error", (error: Error) => {
                    // log("error", `Received error for borrower: ${borrower} with message: ${error.message}`)
                    console.log(error);
                    this.borrowersInProgress = this.borrowersInProgress.filter((value) => value != borrower);
                    console.log(this.pendingTransactions);
                    this.errorCount++;
                });
        }
    }

    // https://ethereum.stackexchange.com/questions/84545/how-to-get-reason-revert-using-web3-eth-call
    public async getRevertReason(txReceipt: TransactionReceipt): Promise<string> {
        var result: string = await this.client.eth.call(txReceipt, txReceipt.blockNumber);

        result = result.startsWith('0x') ? result : `0x${result}`;

        let reason: string = "";
        if (result && result.substring(138)) {
          reason = this.client.utils.toAscii(result.substring(138));
        }
        return reason;
    }

    public isHealthy(): boolean {
        return this.errorCount < MAX_ACCEPTABLE_ERRORS;
    }
    
}
