import parse from 'parse-duration';
import Web3 from 'web3';
import { Address } from 'viem';

export type BaseConfig = {
  chainConfigs: AloeChainConfig[];
  multicallAddress: Address;
  createAccountTopicID: string;
  initialDeploy: number;
  reconnectMaxAttemmpts: number;
  errorThreshold: number;
};

export type AloeChainConfig = {
  chainName: string;
  chainNumber: number;
  factory: Address;
  borrowerLens: Address;
  borrower: Address;
};

type NumericalFieldsAs<T> = {
  timeToWaitBeforeLiquidation: T;
  pollingInterval: T;
  processLiquidatableInterval: T;
  heartbeatInterval: T;
  heartbeatTimeout: T;
  clientKeepAliveTimeout: T;
  sanityCheckInterval: T;
  reconnectDelay: T;
  restartTimeout: T;
};

type UnparsedConfig = BaseConfig & NumericalFieldsAs<string>;
export type Config = BaseConfig & NumericalFieldsAs<number | undefined>;

type ConditionFunc<T> = (input: T) => boolean;

const DEFAULT_TIME_UNIT = 'millisecond';

const greaterThanZero = (input: number | undefined) => {
  return input !== undefined && input > 0;
};

const greaterThanOrEqualToZero = (input: number | undefined) => {
  return input !== undefined && input >= 0;
};

const isAddress = (input: string, chainNumber?: number) => {
  return Web3.utils.isAddress(input, chainNumber);
};

const isNotEmpty = (input: string) => {
  return input !== '';
};

export function readConfig(unparsedConfig: UnparsedConfig): Config {
  const config = parseConfig(unparsedConfig);
  if (!isValidConfig(config)) {
    throw new Error('Invalid config provided');
  }
  return config;
}

function parseConfig(config: UnparsedConfig): Config {
  return {
    chainConfigs: config.chainConfigs,
    multicallAddress: config.multicallAddress,
    createAccountTopicID: config.createAccountTopicID,
    initialDeploy: config.initialDeploy,
    timeToWaitBeforeLiquidation: parseDuration(config.timeToWaitBeforeLiquidation),
    pollingInterval: parseDuration(config.pollingInterval),
    processLiquidatableInterval: parseDuration(config.processLiquidatableInterval),
    heartbeatInterval: parseDuration(config.heartbeatInterval),
    heartbeatTimeout: parseDuration(config.heartbeatTimeout),
    clientKeepAliveTimeout: parseDuration(config.clientKeepAliveTimeout),
    sanityCheckInterval: parseDuration(config.sanityCheckInterval),
    reconnectDelay: parseDuration(config.reconnectDelay),
    reconnectMaxAttemmpts: config.reconnectMaxAttemmpts,
    errorThreshold: config.errorThreshold,
    restartTimeout: parseDuration(config.restartTimeout),
  };
}

function parseDuration(duration: string): number {
  const result = parse(duration, DEFAULT_TIME_UNIT);
  if (result !== undefined && result !== null) {
    return result;
  }
  throw new Error(`Invalid duration provided: ${duration}`);
}

function isValidChainConfig(chainConfig: AloeChainConfig) {
  return isAddress(chainConfig.factory) && isAddress(chainConfig.borrower) && isAddress(chainConfig.borrowerLens);
}

function isValid<T>(fieldName: string, condition: ConditionFunc<T>) {
  return function (fieldValue: T) {
    if (!condition(fieldValue)) {
      console.error(`Invalid value: ${fieldValue} provided for ${fieldName}`);
      return false;
    }
    return true;
  };
}

export default function isValidConfig(config: Config): boolean {
  for (const chainConfig of config.chainConfigs) {
    if (!isValidChainConfig(chainConfig)) {
      return false;
    }
  }

  const stringFieldValidators = new Map([
    [config.multicallAddress, isValid('multicallAddress', isAddress)],
    [config.createAccountTopicID, isValid('createAccountTopicID', isNotEmpty)],
  ]);

  for (const [field, validator] of stringFieldValidators) {
    if (!validator(field)) {
      return false;
    }
  }

  const numericFieldsToValidators = new Map([
    [config.initialDeploy, isValid('initialDeploy', greaterThanOrEqualToZero)],
    [config.pollingInterval, isValid('pollingInterval', greaterThanZero)],
    [config.processLiquidatableInterval, isValid('processLiquidatableInterval', greaterThanZero)],
    [config.heartbeatInterval, isValid('heartbeatInterval', greaterThanZero)],
    [config.clientKeepAliveTimeout, isValid('clientKeepAliveTimeout', greaterThanZero)],
    [config.sanityCheckInterval, isValid('sanityCheckInterval', greaterThanZero)],
    [config.reconnectDelay, isValid('reconnectDelay', greaterThanZero)],
    [config.reconnectMaxAttemmpts, isValid('reconnectMaxAttempts', greaterThanOrEqualToZero)],
    [config.errorThreshold, isValid('errorThreshold', greaterThanZero)],
    [config.restartTimeout, isValid('restartTimeout', greaterThanOrEqualToZero)],
    [config.timeToWaitBeforeLiquidation, isValid('timeToWaitBeforeLiquidation', greaterThanZero)]
  ]);

  for (const [field, validator] of numericFieldsToValidators) {
    if (!validator(field)) {
      return false;
    }
  }

  return true;
}
