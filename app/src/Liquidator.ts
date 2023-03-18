import Web3 from "web3";
import { Log } from "web3-core";
import { Contract } from "web3-eth-contract";
import { AbiItem } from "web3-utils";
import LiquidatorABIJson from "./abis/Liquidator.json";
import TxManager from "./TxManager";
import winston from "winston";
import Bottleneck from "bottleneck";

const FACTORY_ADDRESS: string = process.env.FACTORY_ADDRESS!;
const CREATE_ACCOUNT_TOPIC_ID: string = process.env.CREATE_ACCOUNT_TOPIC_ID!;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS!;
const ALOE_INITIAL_DEPLOY = 0;
const POLLING_INTERVAL = 60_000;
const STATUS_HEALTHY = 200;
const STATUS_NOT_HEALTHY = 503;
const REQUEST_RATE_LIMIT = 250;
const ERROR_THRESHOLD = 5;
const GAS_LIMIT = 3_000_000;

export type HealthCheckResponse = {
  code: number;
  message: string;
};

export default class Liquidator {
  private pollingInterval: NodeJS.Timer | null;
  private web3: Web3;
  private liquidatorContract: Contract;
  private txManager: TxManager;
  private borrowers: string[];
  private uniqueId: string;
  private limiter: Bottleneck;
  private errorCount: number;

  constructor(jsonRpcURL: string, liquidatorAddress: string) {
    this.pollingInterval = null;
    const provider = new Web3.providers.WebsocketProvider(jsonRpcURL, {
      clientConfig: {
        keepalive: true,
        keepaliveInterval: 60000, // ms
      },
      reconnect: {
        auto: true,
        delay: 5000,
        maxAttempts: 5,
        onTimeout: false,
      },
    });
    this.web3 = new Web3(provider);
    this.web3.eth.handleRevert = true;
    this.liquidatorContract = new this.web3.eth.Contract(
      LiquidatorABIJson as AbiItem[],
      liquidatorAddress
    );
    this.txManager = new TxManager(this.web3);
    this.borrowers = [];
    this.uniqueId = Math.floor(100000 + Math.random() * 900000).toString();
    this.limiter = new Bottleneck({
      minTime: REQUEST_RATE_LIMIT,
    });
    this.errorCount = 0;
  }

  public start() {
    winston.log("info", `🔋 Powering up liquidation bot #${this.uniqueId}`);
    this.txManager.init();

    this.collectBorrowers(ALOE_INITIAL_DEPLOY);

    this.pollingInterval = setInterval(() => {
      console.log("Scanning borrowers...");
      this.scan(this.borrowers);
    }, POLLING_INTERVAL);
  }

  public async stop(): Promise<void> {
    winston.log("info", `🪫 Powering down liquidation bot #${this.uniqueId}`);
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    return new Promise((resolve, reject) => {
      this.web3.eth.clearSubscriptions((error: Error, result: boolean) => {
        if (error) {
          console.error(error);
          return reject(error);
        }
        return resolve();
      });
    });
  }

  public async isHealthy(): Promise<HealthCheckResponse> {
    if (this.errorCount > ERROR_THRESHOLD) {
      return {
        code: STATUS_NOT_HEALTHY,
        message: "Liquidator error threshold exceeded",
      };
    }
    try {
      const result: boolean = await this.web3.eth.net.isListening();
      console.log("Is listening?", result);
      if (!result) {
        return {
          code: STATUS_NOT_HEALTHY,
          message: "unable to listen to peers",
        };
      }
    } catch (e) {
      const msg: string = (e as Error).message;
      return {
        code: STATUS_NOT_HEALTHY,
        message: msg,
      };
    }
    if (!this.txManager.isHealthy()) {
      return {
        code: STATUS_NOT_HEALTHY,
        message: "transaction manager is not healthy",
      };
    }
    return {
      code: STATUS_HEALTHY,
      message: "healthy",
    };
  }

  private collectBorrowersCallback(error: Error, result: Log) {
    if (!error) {
      const borrowerAddress: string = Liquidator.formatAddress(result.data);
      if (!this.borrowers.includes(borrowerAddress)) {
        winston.log(
          "debug",
          `Detected new borrower! Adding \`${borrowerAddress}\` to global list (${this.borrowers.length} total).`
        );
        this.borrowers.push(borrowerAddress);
      } else {
        winston.log(
          "debug",
          `Received duplicate creation event for borrower ${borrowerAddress}`
        );
      }
    } else {
      this.errorCount += 1;
      winston.log("error", `Error when collecting borrowers: ${error}`);
    }
  }

  private collectBorrowers(block: number) {
    this.web3.eth.subscribe(
      "logs",
      {
        address: FACTORY_ADDRESS,
        topics: [CREATE_ACCOUNT_TOPIC_ID],
        fromBlock: block,
      },
      this.collectBorrowersCallback.bind(this)
    );
  }

  private scan(borrowers: string[]): void {
    borrowers.forEach((borrower) => {
      this.limiter.schedule(async () => {
        const solvent: boolean = await this.isSolvent(borrower);
        console.log("Is solvent?", solvent, borrower);
        if (!solvent) {
          // TODO: We probably don't actually want to log this here, at least not at "info" level (since that'll send it to Slack every time).
          //       It gets called repeatedly until the borrower is actually liquidated. We really only want to send a notifiction when it's
          //       first added to the queue, and when it either succeeds/fails/retries. Not on every scan.
          winston.log(
            "info",
            `#${this.uniqueId} 🧜 Sending \`${borrower}\` to transaction manager for liquidation!`
          );
          console.log("Adding borrower to liquidation queue...", borrower);
          this.txManager.addLiquidatableAccount(borrower);
        }
      });
    });
  }

  async isSolvent(borrower: string): Promise<boolean> {
    const shortName = borrower.slice(0, 8);
    try {
      winston.log(
        "debug",
        `Checking solvency of ${shortName} via gas estimation...`
      );

      const data = this.web3.eth.abi.encodeParameter("address", WALLET_ADDRESS);
      console.log(
        "Checking solvency of",
        borrower,
        "via gas estimation...",
        data
      );
      const estimatedGasLimit: number = await this.liquidatorContract.methods
        .liquidate(borrower, data, 1)
        .estimateGas({
          gasLimit: GAS_LIMIT,
        });

      winston.log(
        "debug",
        `--> Received estimate (${estimatedGasLimit} gas), indicating that ${shortName} can be liquidated`
      );
      return false;
    } catch (e) {
      const msg = (e as Error).message;

      if (msg.includes("Aloe: healthy")) {
        winston.log("debug", `--> ${shortName} is healthy`);
      } else {
        console.log(
          "WARNING: Received estimation error other than 'Aloe: healthy'",
          msg
        );
        console.log(
          "This most likely means that we just warned them and we are waiting to actually liquidate them."
        );
      }
      return true;
    }
  }

  static formatAddress(hexString: string): string {
    // Check that the string starts with '0x'
    let result: string = "0x";
    // Addresses are 40 characters long, but we may have leading zeroes, so we should
    // take the unneeded 0s out
    result = result.concat(hexString.substring(hexString.length - 40));
    return result;
  }
}
