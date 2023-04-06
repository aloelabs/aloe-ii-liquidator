import Web3 from "web3";
import { Log } from "web3-core";
import { Contract } from "web3-eth-contract";
import { AbiItem } from "web3-utils";
import LiquidatorABIJson from "./abis/Liquidator.json";
import TxManager from "./TxManager";
import winston from "winston";
import Bottleneck from "bottleneck";

export const MAX_STRAIN = 10;
export const MIN_STRAIN = 1;
const FACTORY_ADDRESS: string = process.env.FACTORY_ADDRESS!;
const CREATE_ACCOUNT_TOPIC_ID: string = process.env.CREATE_ACCOUNT_TOPIC_ID!;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS!;
const ALOE_INITIAL_DEPLOY = 0;
const POLLING_INTERVAL_MS = 60_000;
const CLIENT_KEEPALIVE_INTERVAL_MS = 60_000;
const RECONNECT_DELAY_MS = 5_000;
const RECONNECT_MAX_ATTEMPTS = 5;
const STATUS_HEALTHY = 200;
const STATUS_NOT_HEALTHY = 503;
const ERROR_THRESHOLD = 5;

export type HealthCheckResponse = {
  code: number;
  message: string;
};

export default class Liquidator {
  public static readonly GAS_LIMIT = 3_000_000;
  private pollingInterval: NodeJS.Timer | null;
  private web3: Web3;
  private liquidatorContract: Contract;
  private txManager: TxManager;
  private borrowers: string[];
  private uniqueId: string;
  private limiter: Bottleneck;
  private errorCount: number;

  /**
   * Creates a new Liquidator instance.
   * @param jsonRpcURL the URL of the JSON-RPC endpoint to use
   * @param liquidatorAddress the address of the liquidator contract
   * @param limiter the Bottleneck instance to use for rate limiting
   */
  constructor(
    jsonRpcURL: string,
    liquidatorAddress: string,
    limiter: Bottleneck
  ) {
    this.pollingInterval = null;
    const provider = new Web3.providers.WebsocketProvider(jsonRpcURL, {
      clientConfig: {
        keepalive: true,
        keepaliveInterval: CLIENT_KEEPALIVE_INTERVAL_MS,
      },
      reconnect: {
        auto: true,
        delay: RECONNECT_DELAY_MS,
        maxAttempts: RECONNECT_MAX_ATTEMPTS,
        onTimeout: false,
      },
    });
    this.web3 = new Web3(provider);
    this.web3.eth.handleRevert = true;
    this.liquidatorContract = new this.web3.eth.Contract(
      LiquidatorABIJson as AbiItem[],
      liquidatorAddress,
    );
    this.txManager = new TxManager(this.web3, this.liquidatorContract);
    this.borrowers = [];
    this.uniqueId = Math.floor(100000 + Math.random() * 900000).toString();
    this.limiter = limiter;
    this.errorCount = 0;
  }

  /**
   * Starts the liquidator.
   * Logs the start message and initializes the transaction manager.
   * Then, it scans the borrowers and starts the polling interval.
   */
  public async start(): Promise<void> {
    const chainId = await this.web3.eth.getChainId();
    winston.log(
      "info",
      `🔋 Powering up liquidation bot #${
        this.uniqueId
      } on ${Liquidator.getChainName(chainId)}`
    );
    this.txManager.init(chainId);

    this.collectBorrowers(ALOE_INITIAL_DEPLOY);

    this.pollingInterval = setInterval(() => {
      console.log("Scanning borrowers...");
      this.scan(this.borrowers);
    }, POLLING_INTERVAL_MS);
  }

  /**
   * Shuts down the liquidator.
   * @returns {Promise<void>} A promise that resolves when the liquidator has shut down.
   */
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

  /**
   * Checks if the liquidator is healthy.
   * This includes checking that the liquidator hasn't errored too many times,
   * that the node is listening to peers, and that the transaction manager is healthy.
   * @returns {Promise<HealthCheckResponse>} The health check response.
   */
  public async isHealthy(): Promise<HealthCheckResponse> {
    // First check if the Liquidator has errored too many times
    if (this.errorCount > ERROR_THRESHOLD) {
      return {
        code: STATUS_NOT_HEALTHY,
        message: "Liquidator error threshold exceeded",
      };
    }
    // Check if the transaction manager is healthy
    if (!this.txManager.isHealthy()) {
      return {
        code: STATUS_NOT_HEALTHY,
        message: "transaction manager is not healthy",
      };
    }
    // If everythings checks out, return healthy
    return {
      code: STATUS_HEALTHY,
      message: "healthy",
    };
  }

  /**
   * Collects the borrowers from the Aloe Factory contract.
   * @param error
   * @param result
   */
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

  /**
   * Collects the borrowers from the Aloe Factory contract.
   * @param block The block to start collecting borrowers from.
   */
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

  /**
   * Scans the borrowers and sends them to the transaction manager for liquidation (if they're insolvent).
   * @param borrowers The borrowers to scan.
   */
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
        .liquidate(borrower, data, MIN_STRAIN)
        .estimateGas({
          gasLimit: Liquidator.GAS_LIMIT,
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

  /**
   * Gets the base Etherscan URL for a given chain ID.
   * @param chainId The chain ID.
   * @returns The base Etherscan URL.
   */
  public static getBaseEtherscanUrl(chainId: number): string {
    switch (chainId) {
      case 1:
        return "https://etherscan.io/tx/";
      case 5:
        return "https://goerli.etherscan.io/tx/";
      case 10:
        return "https://optimistic.etherscan.io/tx/";
      case 42161:
        return "https://arbiscan.io/tx/";
      default:
        return "https://etherscan.io/tx/";
    }
  }

  /**
   * Gets the chain name from the chain ID.
   * @param chainId The chain ID.
   * @returns The chain name.
   */
  static getChainName(chainId: number): string {
    switch (chainId) {
      case 1:
        return "mainnet";
      case 5:
        return "goerli";
      case 10:
        return "optimism";
      case 42161:
        return "arbitrum";
      default:
        return "unknown";
    }
  }

  /**
   * Formats an address to be 0x-prefixed and 40 characters long.
   * @param hexString The address to format.
   * @returns The formatted address.
   */
  static formatAddress(hexString: string): string {
    // Check that the string starts with '0x'
    let result: string = "0x";
    // Addresses are 40 characters long, but we may have leading zeroes, so we should
    // take the unneeded 0s out
    result = result.concat(hexString.substring(hexString.length - 40));
    return result;
  }
}
