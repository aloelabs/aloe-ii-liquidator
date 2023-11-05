import Web3 from "web3";
import { WebsocketProvider } from "web3-providers-ws";
import { Log } from "web3-core";
import { Contract } from "web3-eth-contract";
import { AbiItem } from "web3-utils";
import LiquidatorABIJson from "./abis/Liquidator.json";
import MarginAccountABIJson from "./abis/MarginAccount.json";
import MarginAccountLensABIJson from "./abis/MarginAccountLens.json";
import TxManager from "./TxManager";
import winston from "winston";
import Bottleneck from "bottleneck";
import * as Sentry from "@sentry/node";
import { getLogsBaseScan, withTimeout } from "./Utils";
import Big from "big.js";
import { ContractCallContext, Multicall } from "ethereum-multicall";

const ALOE_II_FACTORY_ADDRESS_OPTIMISM =
  "0x95110C9806833d3D3C250112fac73c5A6f631E80";
const ALOE_II_FACTORY_ADDRESS_ARBITRUM =
  "0x95110C9806833d3D3C250112fac73c5A6f631E80";
const ALOE_II_FACTORY_ADDRESS_BASE =
  "0xA56eA45565478Fcd131AEccaB2FE934F23BAD8dc";
const FACTORY_ADDRESS: { [key: number]: string } = {
  10: ALOE_II_FACTORY_ADDRESS_OPTIMISM,
  42161: ALOE_II_FACTORY_ADDRESS_ARBITRUM,
  8453: ALOE_II_FACTORY_ADDRESS_BASE,
};
const ALOE_II_MARGIN_ACCOUNT_LENS_ADDRESS_OPTIMISM =
  "0x8A15bfEBff7BF9ffaBBeAe49112Dc2E6C4E73Eaf";
const ALOE_II_MARGIN_ACCOUNT_LENS_ADDRESS_ARBITRUM =
  "0x8A15bfEBff7BF9ffaBBeAe49112Dc2E6C4E73Eaf";
const ALOE_II_MARGIN_ACCOUNT_LENS_ADDRESS_BASE =
  "0x1B054cc7D2E54329c1f5B350Fb8C690eA7A5ec3F";
const ALOE_II_MARGIN_ACCOUNT_LENS_ADDRESS: { [key: number]: string } = {
  10: ALOE_II_MARGIN_ACCOUNT_LENS_ADDRESS_OPTIMISM,
  42161: ALOE_II_MARGIN_ACCOUNT_LENS_ADDRESS_ARBITRUM,
  8453: ALOE_II_MARGIN_ACCOUNT_LENS_ADDRESS_BASE,
};
const MULTICALL_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const CREATE_ACCOUNT_TOPIC_ID =
  "0x1ff0a9a76572c6e0f2f781872c1e45b4bab3a0d90df274ebf884b4c11e3068f4";
const WALLET_ADDRESS = process.env.WALLET_ADDRESS!;
const ALOE_INITIAL_DEPLOY = 0;
const POLLING_INTERVAL_MS = 45_000; // 45 seconds
export const PROCESS_LIQUIDATABLE_INTERVAL_MS = 20_000; // 20 seconds
const HEARTBEAT_INTERVAL_MS = 15_000; // 15 seconds
const HEARTBEAT_TIMEOUT_MS = 10_000; // 10 seconds
const CLIENT_KEEPALIVE_INTERVAL_MS = 60_000; // 1 minute
const SANITY_CHECK_INTERVAL_MS = 600_000; // 10 minutes
const RECONNECT_DELAY_MS = 5_000;
const RECONNECT_MAX_ATTEMPTS = 5;
const STATUS_HEALTHY = 200;
const STATUS_NOT_HEALTHY = 503;
const ERROR_THRESHOLD = 5;
const SECONDS_PER_DAY = 86400;
const SECONDS_BETWEEN_RESTARTS = 3 * SECONDS_PER_DAY; // 3 days

export type HealthCheckResponse = {
  code: number;
  message: string;
};

enum LiquidationError {
  Healthy = "Aloe: healthy",
  Grace = "Aloe: grace",
  Unknown = "unknown",
}

type LiquidateArgs = {
  borrower: string;
  data: string;
  strain: number;
};

type EstimateGasLiquidationResult = {
  success: boolean;
  estimatedGas: number;
  args: LiquidateArgs;
  error?: LiquidationError;
  errorMsg?: string;
};

export default class Liquidator {
  public static readonly MAX_STRAIN = 20;
  public static readonly MIN_STRAIN = 1;
  public static readonly GAS_LIMIT = 3_000_000;
  private pollingInterval: NodeJS.Timeout | null;
  private processLiquidatableInterval: NodeJS.Timeout | null;
  private sanityCheckInterval: NodeJS.Timeout | null;
  private heartbeatInterval: NodeJS.Timeout | null;
  private provider: WebsocketProvider;
  private web3: Web3;
  private multicall: Multicall;
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
    this.processLiquidatableInterval = null;
    this.sanityCheckInterval = null;
    this.heartbeatInterval = null;
    const wsProvider = new Web3.providers.WebsocketProvider(jsonRpcURL, {
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
    this.provider = wsProvider;
    this.web3 = new Web3(wsProvider);
    this.web3.eth.handleRevert = true;
    this.multicall = new Multicall({
      web3Instance: this.web3,
      tryAggregate: true,
      multicallCustomContractAddress: MULTICALL_ADDRESS,
    });
    this.liquidatorContract = new this.web3.eth.Contract(
      LiquidatorABIJson as AbiItem[],
      liquidatorAddress
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

    await this.collectBorrowers(ALOE_INITIAL_DEPLOY, chainId);
    this.startHeartbeat();

    this.pollingInterval = setInterval(() => {
      console.log(
        `#${this.uniqueId} Scanning borrowers on ${Liquidator.getChainName(
          chainId
        )}...`
      );
      this.scanBorrowers(chainId);
    }, POLLING_INTERVAL_MS);

    this.sanityCheckInterval = setInterval(() => {
      console.log(
        `#${this.uniqueId} Performing sanity check on ${Liquidator.getChainName(
          chainId
        )}...`
      );
      this.performSanityCheck();
    }, SANITY_CHECK_INTERVAL_MS);

    this.processLiquidatableInterval = setInterval(() => {
      console.log(
        `#${
          this.uniqueId
        } Processing liquidatable candidates on ${Liquidator.getChainName(
          chainId
        )}...`
      );
      this.txManager.processLiquidatableCandidates();
    }, PROCESS_LIQUIDATABLE_INTERVAL_MS);
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
    if (this.sanityCheckInterval) {
      clearInterval(this.sanityCheckInterval);
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.processLiquidatableInterval) {
      clearInterval(this.processLiquidatableInterval);
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
    const time = process.uptime();
    // Restart if the uptime exceeds the threshold
    if (time > SECONDS_BETWEEN_RESTARTS) {
      return {
        code: STATUS_NOT_HEALTHY,
        message: `uptime ${time} exceeds ${SECONDS_BETWEEN_RESTARTS}`,
      };
    }
    // Check to make sure the provider is connected, if this is transient, the liquidator will recover
    if (!this.provider.connected) {
      return {
        code: STATUS_NOT_HEALTHY,
        message: "provider is not connected",
      };
    }
    // Check if the Liquidator has errored too many times
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
  private collectBorrowersCallback(error: Error | null, result: Log) {
    if (!error) {
      const borrowerAddress: string = Liquidator.formatAddress(result.data);
      if (!this.borrowers.includes(borrowerAddress)) {
        winston.log(
          "debug",
          `#${this.uniqueId} Detected new borrower! Adding \`${borrowerAddress}\` to global list (${this.borrowers.length} total).`
        );
        this.borrowers.push(borrowerAddress);
      } else {
        winston.log(
          "debug",
          `#${this.uniqueId} Received duplicate creation event for borrower ${borrowerAddress}`
        );
      }
    } else {
      this.errorCount += 1;
      winston.log(
        "error",
        `#${this.uniqueId} Error when collecting borrowers: ${error}`
      );
    }
  }

  /**
   * Collects the borrowers from the Aloe Factory contract.
   * @param block The block to start collecting borrowers from.
   */
  private async collectBorrowers(block: number, chainId: number) {
    if (chainId === 8453) {
      // Base doesn't let us get past logs, so we have to use basescan to get the initial list of borrowers
      const response = await getLogsBaseScan(
        0,
        FACTORY_ADDRESS[chainId],
        [CREATE_ACCOUNT_TOPIC_ID],
        true
      );
      const status = response.status;
      if (status === 200) {
        const logs = response.data.result;
        for (const log of logs) {
          this.collectBorrowersCallback(null, log);
        }
      } else {
        this.errorCount += 1;
        winston.log(
          "error",
          `#${this.uniqueId} Error when collecting borrowers: ${status}`
        );
      }
    }
    this.web3.eth.subscribe(
      "logs",
      {
        address: FACTORY_ADDRESS[chainId],
        topics: [CREATE_ACCOUNT_TOPIC_ID],
        fromBlock: 0,
      },
      this.collectBorrowersCallback.bind(this)
    );
  }

  private liquidateBorrower(borrower: string): void {
    // TODO: Check if we need to warn the user first (and thus send a different message)
    // TODO: We probably don't actually want to log this here, at least not at "info" level (since that'll send it to Slack every time).
    //       It gets called repeatedly until the borrower is actually liquidated. We really only want to send a notifiction when it's
    //       first added to the queue, and when it either succeeds/fails/retries. Not on every scan.
    winston.log(
      "info",
      `#${this.uniqueId} 🧜 Sending \`${borrower}\` to transaction manager for liquidation!`
    );
    this.txManager.addLiquidatableAccount(borrower);
  }

  /**
   * Scans the borrowers and sends them to the transaction manager for liquidation (if they're insolvent).
   * @param borrowers The borrowers to scan.
   */
  private async scanBorrowers(chainId: number): Promise<void> {
    const contractCallContext: ContractCallContext[] = this.borrowers.map(
      (borrower) => {
        return {
          reference: borrower,
          contractAddress: ALOE_II_MARGIN_ACCOUNT_LENS_ADDRESS[chainId],
          abi: MarginAccountLensABIJson,
          calls: [
            {
              methodName: "getHealth",
              methodParameters: [borrower, true],
              reference: borrower,
            },
          ],
        };
      }
    );
    // Get the health of each borrower
    const results = (await this.multicall.call(contractCallContext)).results;
    // Check the health of each borrower and liquidate them if they're insolvent
    for (const result of Object.entries(results)) {
      const borrower = result[0];
      const healthResults = result[1].callsReturnContext[0].returnValues;
      const healthA = new Big(
        this.web3.utils.hexToNumberString(healthResults[0].hex)
      )
        .div(10 ** 18)
        .toNumber();
      const healthB = new Big(
        this.web3.utils.hexToNumberString(healthResults[1].hex)
      )
        .div(10 ** 18)
        .toNumber();
      const health = Math.min(healthA, healthB);
      winston.log(
        "debug",
        `#${this.uniqueId} ${borrower} has health ${health}`
      );
      if (health <= 1) {
        // TODO: Check if we need to warn the user first (and thus send a different message)
        // Double check that the borrower is actually liquidatable
        const estimatedGasResult: EstimateGasLiquidationResult =
          await this.estimateGasForLiquidation(borrower, 20);
        if (estimatedGasResult.success) {
          this.liquidateBorrower(borrower);
        }
      }
    }
    // Shuffle the borrowers after each scan to randomize the order.
    this.limiter.schedule(() => {
      return new Promise<void>((resolve) => {
        this.shuffleBorrowers();
        resolve();
      });
    });
  }

  private async performSanityCheck(): Promise<void> {
    for (const borrower of this.borrowers) {
      this.limiter.schedule(async () => {
        const solvent: boolean = await this.isSolvent(borrower);
        winston.log(
          "debug",
          `#${this.uniqueId} Sanity check: ${borrower} is ${
            solvent ? "healthy" : "unhealthy"
          }`
        );
        if (!solvent) {
          this.liquidateBorrower(borrower);
        }
      });
    }
  }

  // TODO: clean up this function
  private async isSolvent(borrower: string): Promise<boolean> {
    const shortName = borrower.slice(0, 8);
    winston.log(
      "debug",
      `#${this.uniqueId} Checking solvency of ${shortName} via gas estimation...`
    );
    const estimatedGasResult: EstimateGasLiquidationResult =
      await this.estimateGasForLiquidation(borrower, Liquidator.MAX_STRAIN);
    if (estimatedGasResult.success) {
      return false;
    } else if (estimatedGasResult.error === LiquidationError.Healthy) {
      return true;
    } else if (estimatedGasResult.error === LiquidationError.Grace) {
      winston.log(
        "info",
        `#${this.uniqueId} ⏳ ${shortName} is in grace period`
      );
      return true;
    } else {
      // Checking the unleashLiquidationTime is a workaround for a none-critical bug.
      const borrowerContract = new this.web3.eth.Contract(
        MarginAccountABIJson as AbiItem[],
        borrower
      );
      const slot0 = await borrowerContract.methods.slot0().call();
      const unleashLiquidationTime = slot0.unleashLiquidationTime;
      if (unleashLiquidationTime === "0") {
        winston.log(
          "debug",
          `#${this.uniqueId} 🚨 Something unexpected happened. ${shortName} reverted with an unknown message and has an unleashLiquidationTime of 0. Error encountered: ${estimatedGasResult.errorMsg}.`
        );
      } else {
        winston.log(
          "debug",
          `#${this.uniqueId} 🟠 ${shortName} is likely healthy, but has an unleashLiquidationTime of ${unleashLiquidationTime}. This is likely a result of the bug with repay/modify.`
        );
        Sentry.withScope((scope) => {
          scope.setContext("info", {
            args: estimatedGasResult.args,
          });
          Sentry.captureMessage(
            `#${this.uniqueId} 🟠 ${shortName} is likely healthy, but has an unleashLiquidationTime of ${unleashLiquidationTime}. This is likely a result of the bug with repay/modify.`,
            "warning"
          );
        });
      }
      return true;
    }
  }

  private async estimateGasForLiquidation(
    borrower: string,
    strain: number
  ): Promise<EstimateGasLiquidationResult> {
    const integerStrain = Math.floor(strain);
    if (
      integerStrain < Liquidator.MIN_STRAIN ||
      integerStrain > Liquidator.MAX_STRAIN
    ) {
      throw new Error(`Invalid strain: ${strain}`);
    }
    const encodedAddress = this.web3.eth.abi.encodeParameter(
      "address",
      WALLET_ADDRESS
    );
    try {
      const estimatedGasLimit: number = await this.liquidatorContract.methods
        .liquidate(borrower, encodedAddress, integerStrain)
        .estimateGas({
          gasLimit: Liquidator.GAS_LIMIT,
        });
      return {
        success: true,
        estimatedGas: estimatedGasLimit,
        args: {
          borrower,
          data: encodedAddress,
          strain: integerStrain,
        },
      };
    } catch (e) {
      const errorMsg = (e as Error).message;
      let errorType: LiquidationError = LiquidationError.Unknown;
      if (errorMsg.includes(LiquidationError.Healthy)) {
        errorType = LiquidationError.Healthy;
      } else if (errorMsg.includes(LiquidationError.Grace)) {
        errorType = LiquidationError.Grace;
      }
      return {
        success: false,
        estimatedGas: 0,
        args: {
          borrower,
          data: encodedAddress,
          strain: integerStrain,
        },
        error: errorType,
        errorMsg,
      };
    }
  }

  /**
   * Starts the heartbeat interval.
   * This is used to check if the provider is still connected.
   * If the heartbeat fails, the provider will be reconnected.
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      winston.debug(`#${this.uniqueId} Heartbeat already started`);
      return;
    }
    this.heartbeatInterval = setInterval(async () => {
      try {
        winston.debug(`#${this.uniqueId} ♥️ Heartbeat`);
        await withTimeout(this.web3.eth.getChainId(), HEARTBEAT_TIMEOUT_MS);
      } catch (e) {
        Sentry.captureException(e);
        this.provider.reconnect();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private shuffleBorrowers(): void {
    let currentIndex = this.borrowers.length;
    let randomIndex: number;

    while (currentIndex !== 0) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;

      [this.borrowers[currentIndex], this.borrowers[randomIndex]] = [
        this.borrowers[randomIndex],
        this.borrowers[currentIndex],
      ];
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
      case 8453:
        return "https://basescan.org/tx/";
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
      case 8453:
        return "base";
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
