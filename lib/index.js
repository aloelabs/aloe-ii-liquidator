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
exports.LiquidationType = void 0;
const web3_1 = __importDefault(require("web3"));
const MarginAccount_json_1 = __importDefault(require("./abis/MarginAccount.json"));
const Liquidator_json_1 = __importDefault(require("./abis/Liquidator.json"));
const SlackHook_1 = __importDefault(require("./SlackHook"));
const dotenv_1 = __importDefault(require("dotenv"));
const dotenv_expand_1 = __importDefault(require("dotenv-expand"));
const winston_1 = __importDefault(require("winston"));
const TxManager_1 = __importDefault(require("./TxManager"));
const config = dotenv_1.default.config();
dotenv_expand_1.default.expand(config);
const web3 = new web3_1.default(new web3_1.default.providers.WebsocketProvider(process.env.OPTIMISM_MAINNET_ENDPOINT));
web3.eth.handleRevert = true;
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const CREATE_ACCOUNT_TOPIC_ID = process.env.CREATE_ACCOUNT_TOPIC_ID;
const ACCOUNT_INDEX = parseInt(process.env.ACCOUNT_INDEX);
const LIQUIDATOR_CONTRACT_ADDRESS = process.env.LIQUIDATOR_ADDRESS;
const LIQUIDATOR_CONTRACT = new web3.eth.Contract(Liquidator_json_1.default, LIQUIDATOR_CONTRACT_ADDRESS);
var LiquidationType;
(function (LiquidationType) {
    LiquidationType[LiquidationType["Warn"] = 0] = "Warn";
    LiquidationType[LiquidationType["Liquidate"] = 1] = "Liquidate";
    LiquidationType[LiquidationType["None"] = 2] = "None";
})(LiquidationType = exports.LiquidationType || (exports.LiquidationType = {}));
// TODO: It may be beneficial to pass in the web3 instance to the TXManager
const txManager = new TxManager_1.default();
txManager.init();
setInterval(() => {
    txManager.pokePendingTransactions();
}, 1000);
// configure winston
winston_1.default.configure({
    format: winston_1.default.format.combine(winston_1.default.format.splat(), winston_1.default.format.simple()),
    transports: [
        new winston_1.default.transports.Console({ handleExceptions: true }),
        new winston_1.default.transports.File({
            level: 'debug',
            filename: 'liquidation-bot-debug.log',
            maxsize: 100000,
        }),
        new SlackHook_1.default(process.env.SLACK_WEBHOOK, { level: 'info' }),
    ],
    exitOnError: false,
});
function format_address(hexString) {
    // Check that the string starts with '0x'
    let result = "0x";
    // Addresses are 40 characters long, but we may have leading zeroes, so we should
    // take the unneeded 0s out
    result = result.concat(hexString.substring(hexString.length - 40));
    return result;
}
function collect_borrowers(block, borrowers) {
    web3.eth.subscribe('logs', {
        address: FACTORY_ADDRESS,
        topics: [CREATE_ACCOUNT_TOPIC_ID],
        fromBlock: block
    }, function (error, result) {
        if (!error) {
            console.log(result);
            const topics = result["topics"];
            // Note: for CreateMarginAccount, the account is at index position 2
            // For CreateBorrower, the account will be at a different index
            // topics[0] = CreateMarginAccount method identified
            // topics[1] = pool
            // topics[2] = account (represents the address of the borrower)
            // topics[3] = owner
            const borrowerAddress = format_address(result.data);
            console.log("Borrower Address: ", borrowerAddress);
            // Now we need to get the the financial details of the Borrower
            if (!borrowers.includes(borrowerAddress))
                borrowers.push(borrowerAddress);
        }
        else {
            winston_1.default.log("error", `Error when collecting borrowers: ${error}`);
        }
    });
}
function scan(borrowers) {
    const promise = Promise.all(borrowers.map((borrower) => __awaiter(this, void 0, void 0, function* () {
        const borrowerContract = new web3.eth.Contract(MarginAccount_json_1.default, borrower);
        // console.log("Borrower: ", borrower);
        // const solvencyType: LiquidationType = setTimeout(() => await isSolvent(borrowerContract, borrower), Math.random());
        // the code below sleep for a random amount of seconds and then check if the borrower is solvent
        // the reason is that we don't want to check all the borrowers at the same time
        // because we want to avoid rate limiting
        const solvencyType = yield new Promise(resolve => setTimeout(() => __awaiter(this, void 0, void 0, function* () {
            resolve(yield isSolvent(borrowerContract, borrower));
        }), Math.random() * 5250));
        if (solvencyType !== LiquidationType.None) {
            winston_1.default.log('debug', `🔵 *Assumed ownership of* ${borrower}`);
            txManager.addLiquidatableAccount(borrower, solvencyType);
            // Actual liquidation logic here
            // winston.log('debug', `🟢 *Liquidated borrower* ${borrower}`);
        }
    })));
    promise.catch(error => console.error(error));
}
function isSolvent(borrowerContract, borrower) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // console.log("Checking solvency or something");
            const gasEstimate = yield borrowerContract.methods.liquidate("0x7BFAAC3EEBe085f91E440E9Fc62394112b533da4", "0x0", 20).estimateGas({ gasLimit: 3000000 });
            // const gasEstimate: number = await LIQUIDATOR_CONTRACT.methods.liquidate(borrower, "0x0", 1).estimateGas({gasLimit:3_000_000})
            console.log(gasEstimate);
            console.log("Borrower is insolvent!", borrower);
            return LiquidationType.Liquidate;
        }
        catch (e) {
            // winston.log("info", `Borrower ${borrower} is solvent!`);
            // console.log(e.message, borrower);
            try {
                const gasEstimate = yield borrowerContract.methods.warn().estimateGas({ gasLimit: 3000000 });
                console.log("warn gasEstimate", gasEstimate);
                console.log("Borrower insolvent, warn called.");
                return LiquidationType.Warn;
            }
            catch (e) {
                if (e.message.includes("Aloe: healthy")) {
                    console.log(e.message, borrower);
                    return LiquidationType.None;
                }
                console.log("a", e.message, borrower, "liquidate");
                return LiquidationType.Liquidate;
            }
        }
    });
}
// First step, get a list of all of the liquidation candidates
const ALOE_INITIAL_DEPLOY = 2394823;
// Initialize the set of the borrowers and populate it w/ all the current borrower accounts
let borrowers = [];
collect_borrowers(ALOE_INITIAL_DEPLOY, borrowers);
const TIMEOUT_IN_MILLISECONDS = 500;
web3.eth.subscribe("newBlockHeaders").on("data", (block) => {
    if (block.number % 20 === 0) {
        // console.log('test');
        scan(borrowers);
    }
}).on("error", () => {
    winston_1.default.log("error", "Error when subscribing to new blocks");
});
process.on("SIGINT", () => {
    console.log("Caught an interrupt signal");
    // Not sure unsubscribe works
    web3.eth.clearSubscriptions((error, result) => {
        if (error) {
            console.error(error);
            process.exit(1);
        }
    });
    process.exit(0);
});
