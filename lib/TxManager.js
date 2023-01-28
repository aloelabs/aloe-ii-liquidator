"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const web3_1 = __importDefault(require("web3"));
const dotenv_1 = require("dotenv");
const dotenv_expand_1 = require("dotenv-expand");
const winston_1 = require("winston");
const MarginAccount_json_1 = __importDefault(require("./abis/MarginAccount.json"));
const Liquidator_json_1 = __importDefault(require("./abis/Liquidator.json"));
const _1 = require(".");
const customConfig = (0, dotenv_1.config)();
(0, dotenv_expand_1.expand)(customConfig);
const web3 = new web3_1.default(new web3_1.default.providers.WebsocketProvider(process.env.OPTIMISM_MAINNET_ENDPOINT));
// TODO: get Liquidator contract address after deploying contract
const LIQUIDATOR_CONTRACT_ADDRESS = process.env.LIQUIDATOR_ADDRESS;
const LIQUIDATOR_CONTRACT = new web3.eth.Contract(Liquidator_json_1.default, LIQUIDATOR_CONTRACT_ADDRESS);
const MAX_RETRIES_ALLOWED = 5;
const GAS_INCREASE_NUMBER = 1.10;
const MAX_PENDING_TIME_IN_SECONDS = 30;
class TXManager {
    constructor() {
        this.currentNonce = 0;
        this.address = "";
        this.gasPriceMaximum = "2000000";
        this.queue = [];
        this.pendingTransactions = new Map();
        this.borrowersInProgress = [];
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            const account = web3.eth.accounts.privateKeyToAccount(process.env.WALLET_PRIVATE_KEY);
            const address = account.address;
            this.currentNonce = yield web3.eth.getTransactionCount(address, "pending");
            this.address = address;
        });
    }
    addLiquidatableAccount(address, liquidationType, shouldProcess = true) {
        this.queue.push({ borrower: address, liquidationType });
        if (shouldProcess)
            this.processLiquidatableCandidates();
    }
    processLiquidatableCandidates() {
        return __awaiter(this, void 0, void 0, function* () {
            for (let i = 0; i < this.queue.length; i++) {
                const candidate = this.queue.shift();
                const borrower = candidate.borrower;
                const borrowerContract = new web3.eth.Contract(MarginAccount_json_1.default, borrower);
                const liquidationType = candidate.liquidationType;
                // Check the map to see if we already have a transaction info for this borrower
                let liquidationTxInfo = this.pendingTransactions.get(borrower);
                if (liquidationTxInfo === undefined) {
                    // Only want to increase currentNonce if we're about to do a new liquidation
                    // this.currentNonce++;
                    const currentGasPrice = yield web3.eth.getGasPrice();
                    liquidationTxInfo = {
                        borrower: borrower,
                        nonce: this.currentNonce,
                        gasPrice: (Math.min(parseInt(currentGasPrice), parseInt(this.gasPriceMaximum)) * 2).toString(),
                        timeSent: new Date().getTime(),
                        retries: 0
                    };
                    this.pendingTransactions.set(borrower, liquidationTxInfo);
                }
                else {
                    if (parseInt(liquidationTxInfo.gasPrice) * GAS_INCREASE_NUMBER <= parseInt(this.gasPriceMaximum)) {
                        const newGasPrice = parseInt(liquidationTxInfo.gasPrice) * GAS_INCREASE_NUMBER;
                        liquidationTxInfo.gasPrice = newGasPrice.toString();
                    }
                    liquidationTxInfo["retries"]++;
                    liquidationTxInfo["timeSent"] = new Date().getTime();
                }
                if (liquidationTxInfo["retries"] > MAX_RETRIES_ALLOWED) {
                    (0, winston_1.log)("debug", `Exceeded maximum amount of retries when attempting to liquidate borrower: ${borrower}`);
                    continue;
                }
                const transactionCount = yield web3.eth.getTransactionCount(this.address, "latest");
                console.log('txnCount', transactionCount);
                const encodedAddress = web3.eth.abi.encodeParameter("address", this.address);
                const methodToCall = liquidationType == _1.LiquidationType.Liquidate ? borrowerContract.methods.liquidate(LIQUIDATOR_CONTRACT_ADDRESS, encodedAddress, 20) : borrowerContract.methods.warn();
                const transactionConfig = {
                    from: this.address,
                    to: borrower,
                    gasPrice: liquidationTxInfo["gasPrice"],
                    gas: this.gasPriceMaximum,
                    nonce: liquidationTxInfo["nonce"],
                    data: methodToCall.encodeABI(),
                };
                console.log(transactionConfig);
                const isInProgress = this.borrowersInProgress.includes(borrower);
                if (!isInProgress) {
                    this.borrowersInProgress.push(borrower);
                    console.log("Sending transaction");
                    console.log(transactionConfig);
                    const signedTransaction = yield web3.eth.accounts.signTransaction(transactionConfig, process.env.WALLET_PRIVATE_KEY);
                    web3.eth.sendSignedTransaction(signedTransaction.rawTransaction)
                        .on("receipt", (receipt) => __awaiter(this, void 0, void 0, function* () {
                        if (receipt.status) {
                            (0, winston_1.log)("info", `Liquidation successful for borrower: ${borrower}`);
                            this.pendingTransactions.delete(borrower);
                        }
                        else {
                            const reason = yield this.getRevertReason(receipt);
                            if (reason.localeCompare("") == 0) {
                                (0, winston_1.log)("error", `EVM revert reason blank when liquidating borrower: ${borrower}`);
                            }
                            switch (reason) { // Used a switch b/c there might be custom logic for other revert codes
                                case "Aloe: healthy":
                                    this.pendingTransactions.delete(borrower);
                                    break;
                                default:
                                    this.queue.push(candidate);
                            }
                        }
                    }))
                        .on("error", (error) => {
                        (0, winston_1.log)("error", `Received error for borrower: ${borrower} with message: ${error.message}`);
                        // remove borrower from borrowersInProgress
                        console.log('liquidation error for borrower', borrower, error.message);
                        this.borrowersInProgress = this.borrowersInProgress.splice(this.borrowersInProgress.indexOf(borrower), 1);
                        this.addLiquidatableAccount(borrower, liquidationType);
                    }).on("sending", () => {
                        console.log("sending");
                    }).on("sent", () => {
                        console.log("sent");
                    }).on("transactionHash", (hash) => {
                        console.log("transactionHash", hash);
                    }).on("confirmation", (confirmationNumber, receipt) => {
                        console.log("confirmation", confirmationNumber, receipt);
                    });
                }
            }
        });
    }
    // https://ethereum.stackexchange.com/questions/84545/how-to-get-reason-revert-using-web3-eth-call
    getRevertReason(txReceipt) {
        return __awaiter(this, void 0, void 0, function* () {
            var result = yield web3.eth.call(txReceipt, txReceipt.blockNumber);
            result = result.startsWith('0x') ? result : `0x${result}`;
            let reason = "";
            if (result && result.substring(138)) {
                reason = web3.utils.toAscii(result.substring(138));
            }
            return reason;
        });
    }
    pokePendingTransactions() {
        // For transactions that have been pending longer than 30 seconds, add them to the queue
        this.pendingTransactions.forEach((liquidationInfo, borrower) => {
            const currentTime = new Date().getTime();
            // Check if 30 seconds has passed
            const elapsedTimeInSeconds = (currentTime - liquidationInfo["timeSent"]) / 1000;
            if (elapsedTimeInSeconds > MAX_PENDING_TIME_IN_SECONDS) {
                // this.addLiquidatableAccount(borrower, LiquidationType.None, false);
            }
        });
    }
}
exports.default = TXManager;
