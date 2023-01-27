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
const Liquidator_json_1 = __importDefault(require("./abis/Liquidator.json"));
const customConfig = (0, dotenv_1.config)();
(0, dotenv_expand_1.expand)(customConfig);
const web3 = new web3_1.default(new web3_1.default.providers.WebsocketProvider(process.env.GOERLI_TESTNET_ENDPOINT));
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
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            const { address } = web3.eth.accounts.privateKeyToAccount(process.env.WALLET_PRIVATE_KEY);
            this.currentNonce = yield web3.eth.getTransactionCount(address);
            this.address = address;
        });
    }
    addLiquidatableAccount(address) {
        this.queue.push(address);
        this.processLiquidatableCandidates();
    }
    processLiquidatableCandidates() {
        return __awaiter(this, void 0, void 0, function* () {
            for (let i = 0; i < this.queue.length; i++) {
                const borrower = this.queue.shift();
                // Check the map to see if we already have a transaction info for this borrower
                let liquidationTxInfo = this.pendingTransactions.get(borrower);
                if (liquidationTxInfo == undefined) {
                    // Only want to increase currentNonce if we're about to do a new liquidation
                    this.currentNonce++;
                    const currentGasPrice = yield web3.eth.getGasPrice();
                    liquidationTxInfo = {
                        borrower: borrower,
                        nonce: this.currentNonce,
                        gasPrice: Math.min(parseInt(currentGasPrice), parseInt(this.gasPriceMaximum)).toString(),
                        timeSent: new Date().getTime(),
                        retries: 0
                    };
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
                const transactionConfig = {
                    from: this.address,
                    to: LIQUIDATOR_CONTRACT_ADDRESS,
                    gasPrice: liquidationTxInfo["gasPrice"],
                    gas: this.gasPriceMaximum,
                    nonce: liquidationTxInfo["nonce"],
                    data: LIQUIDATOR_CONTRACT.methods.liquidate(borrower, "0x0", 1).encodeABI()
                };
                web3.eth.sendTransaction(transactionConfig)
                    .on("receipt", (receipt) => __awaiter(this, void 0, void 0, function* () {
                    if (receipt.status) {
                        (0, winston_1.log)("info", `Liquidation successful for borrower: ${borrower}`);
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
                                this.queue.push(borrower);
                        }
                    }
                }))
                    .on("error", (error) => {
                    (0, winston_1.log)("error", `Received error for borrower: ${borrower} with message: ${error.message}`);
                    this.addLiquidatableAccount(borrower);
                });
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
                this.queue.push(borrower);
            }
        });
    }
}
exports.default = TXManager;
