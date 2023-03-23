import Web3 from "web3";

import { config } from "dotenv";
import { log } from "winston";
import { TransactionConfig, TransactionReceipt } from "web3-eth";
import { Contract } from "web3-eth-contract";
import { Account } from "web3-core";
import Liquidator from "./Liquidator";

config();

const MAX_RETRIES_ALLOWED: number = 5;
const GAS_INCREASE_FACTOR: number = 1.10;
const MAX_ACCEPTABLE_ERRORS = 1;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS!;

type LiquidationTxInfo = {
    borrower: string;
    gasPrice: string;
    timeSent: number;
    retries: number;
}

const MAX_GAS_PRICE_FOR_CHAIN: Map<number, string> = new Map<number, string>([
    [1, "100000000000"],
    [5, "10000000000"],
    [10, "10000000"],
    [42161, "1000000000"],
]);

export default class TXManager {

    private queue: string[];
    private account: Account | null = null;
    private client: Web3;

    private gasPriceMaximum: string = "0";
    private pendingTransactions: Map<string, LiquidationTxInfo>;
    private borrowersInProgress: string[];
    private errorCount: number;
    
    private liquidatorContract: Contract;
    private baseEtherscanURL: string | null = null;

    constructor(web3Client: Web3, liquidatorContract: Contract) {
        this.client = web3Client;
        this.queue = [];
        this.pendingTransactions = new Map<string, LiquidationTxInfo>();
        this.borrowersInProgress = [];
        this.errorCount = 0;
        this.liquidatorContract = liquidatorContract;
    }

    public init(chainId: number) {
        const account: Account = this.client.eth.accounts.privateKeyToAccount(process.env.WALLET_PRIVATE_KEY!);
        this.account = account;
        this.baseEtherscanURL = Liquidator.getBaseEtherscanUrl(chainId);
        this.gasPriceMaximum = TXManager.getMaxGasPriceForChain(chainId);
    }

    public addLiquidatableAccount(address: string) {
        this.queue.push(address);
        this.processLiquidatableCandidates();
    }

    private isLiquidationInProgress(borrower: string): boolean {
        return this.borrowersInProgress.includes(borrower);
    }

    public async processLiquidatableCandidates() {
        if (this.account === null) {
            console.log("No account set, cannot process liquidatable candidates");
            this.errorCount++;
            return;
        }
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
                if (parseInt(liquidationTxInfo.gasPrice) * GAS_INCREASE_FACTOR <= parseInt(this.gasPriceMaximum)) {
                    const newGasPrice: number = Math.ceil(parseInt(liquidationTxInfo.gasPrice) * GAS_INCREASE_FACTOR);
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
            const encodedAddress = this.client.eth.abi.encodeParameter("address", WALLET_ADDRESS);
            const currentNonce = await this.client.eth.getTransactionCount(WALLET_ADDRESS, "pending");
            const estimatedGasLimit: number = await this.liquidatorContract.methods
                .liquidate(borrower, encodedAddress, 1)
                .estimateGas({
                    gasLimit: Liquidator.GAS_LIMIT,
                });
            const updatedGasLimit = Math.ceil(estimatedGasLimit * GAS_INCREASE_FACTOR);
            const encodedData = this.liquidatorContract.methods.liquidate(borrower, encodedAddress, 1).encodeABI();
            const transactionConfig: TransactionConfig = {
                from: WALLET_ADDRESS,
                to: this.liquidatorContract.options.address,
                gasPrice: liquidationTxInfo["gasPrice"],
                gas: updatedGasLimit,
                nonce: currentNonce,
                data: encodedData,
            }

            console.log("transactionConfig: ", transactionConfig);
            
            // An extra check to make sure we don't send the same transaction twice
            if (this.isLiquidationInProgress(borrower))
                continue;
            this.borrowersInProgress.push(borrower);
            const signedTransaction = await this.account.signTransaction(transactionConfig);
            this.client.eth.sendSignedTransaction(signedTransaction.rawTransaction!)
                .on("receipt", async (receipt) => {
                    if (receipt.status) {
                        if (this.baseEtherscanURL !== null) {
                            log("info", `💦 Borrower \`${borrower}\` has been liquidated! ${this.baseEtherscanURL}${receipt.transactionHash}`);
                        } else {
                            log("info", `💦 Borrower \`${borrower}\` has been liquidated!`);
                        }
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

    static getMaxGasPriceForChain(chainId: number): string {
        return MAX_GAS_PRICE_FOR_CHAIN.get(chainId) ?? "0";
    }
    
}
