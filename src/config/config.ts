import parse from 'parse-duration';
import Web3 from 'web3';

export interface Config {
  chainConfigs: aloeChainConfig[];
  multicallAddress: Address;
  createAccountTopicID: string;
  initialDeploy: number;
  pollingInterval?: number;
  processLiquidatableInterval?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  clientKeepAliveTimeout?: number;
  sanityCheckInterval?: number;
  reconnectDelay?: number;
  reconnectMaxAttemmpts?: number;
  errorThreshold: number;
  restartTimeout?: number;
}

interface aloeChainConfig {
  chainName: string;
  chainNumber: number;
  factory: Address;
  borrowerLens: Address;
  borrower: Address;
}

type Address = string;
type ConditionFunc<T> = (input: T) => boolean;

const defaultTimeUnit = 'millisecond';
const emptyString = '';

const greaterThanZero = (input: number | undefined) => {
  return input !== undefined && input > 0;
};
const greaterThanOrEqualToZero = (input: number | undefined) => {
  return input !== undefined && input >= 0;
};
const isAddress = (input: string, chainNumber?: number) => {
  return input !== emptyString && Web3.utils.isAddress(input, chainNumber);
};
const isNotEmpty = (input: string) => {
  return input !== emptyString;
};

export function readConfig(json: any): Config | null {
  try {
    const config: Config = parseConfig(json);
    if (isValidConfig(config)) {
      return config;
    }
  } catch (error) {
    console.error('Error parsing JSON to config:', error);
  }
  return null;
}

function parseConfig(obj: any): Config {
  return {
    chainConfigs: obj.chainConfigs.map((item: aloeChainConfig) => item),
    multicallAddress: obj.multicallAddress,
    createAccountTopicID: obj.createAccountTopicID,
    initialDeploy: obj.initialDeploy,
    pollingInterval: parse(obj.pollingInterval, defaultTimeUnit),
    processLiquidatableInterval: parse(obj.processLiquidatableInterval, defaultTimeUnit),
    heartbeatInterval: parse(obj.heartbeatInterval, defaultTimeUnit),
    heartbeatTimeout: parse(obj.heartbeatTimeout, defaultTimeUnit),
    clientKeepAliveTimeout: parse(obj.clientKeepAliveTimeout, defaultTimeUnit),
    sanityCheckInterval: parse(obj.sanityCheckInterval, defaultTimeUnit),
    reconnectDelay: parse(obj.reconnectDelay, defaultTimeUnit),
    reconnectMaxAttemmpts: obj.reconnectMaxAttemmpts,
    errorThreshold: obj.errorThreshold,
    restartTimeout: parse(obj.restartTimeout, defaultTimeUnit),
  };
}

function isValidChainConfig(chainConfig: aloeChainConfig) {
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

function isValidConfig(config: Config): boolean {
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
  ]);

  for (const [field, validator] of numericFieldsToValidators) {
    if (!validator(field)) {
      return false;
    }
  }

  return true;
}
