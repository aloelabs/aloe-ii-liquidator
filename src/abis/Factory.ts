export const factoryAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'governor', type: 'address', internalType: 'address' },
      { name: 'reserve', type: 'address', internalType: 'address' },
      {
        name: 'oracle',
        type: 'address',
        internalType: 'contract VolatilityOracle',
      },
      {
        name: 'borrowerDeployer',
        type: 'address',
        internalType: 'contract BorrowerDeployer',
      },
      {
        name: 'defaultRateModel',
        type: 'address',
        internalType: 'contract IRateModel',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'DEFAULT_RATE_MODEL',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract IRateModel' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'GOVERNOR',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'LENDER_IMPLEMENTATION',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ORACLE',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract VolatilityOracle',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'claimRewards',
    inputs: [
      {
        name: 'lenders',
        type: 'address[]',
        internalType: 'contract Lender[]',
      },
      { name: 'beneficiary', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: 'earned', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'couriers',
    inputs: [{ name: '', type: 'uint32', internalType: 'uint32' }],
    outputs: [
      { name: 'wallet', type: 'address', internalType: 'address' },
      { name: 'cut', type: 'uint16', internalType: 'uint16' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'createBorrower',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'contract IUniswapV3Pool',
      },
      { name: 'owner', type: 'address', internalType: 'address' },
      { name: 'salt', type: 'bytes12', internalType: 'bytes12' },
    ],
    outputs: [
      {
        name: 'borrower',
        type: 'address',
        internalType: 'contract Borrower',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createMarket',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'contract IUniswapV3Pool',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'enrollCourier',
    inputs: [
      { name: 'id', type: 'uint32', internalType: 'uint32' },
      { name: 'cut', type: 'uint16', internalType: 'uint16' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getMarket',
    inputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IUniswapV3Pool',
      },
    ],
    outputs: [
      {
        name: 'lender0',
        type: 'address',
        internalType: 'contract Lender',
      },
      {
        name: 'lender1',
        type: 'address',
        internalType: 'contract Lender',
      },
      {
        name: 'borrowerImplementation',
        type: 'address',
        internalType: 'contract Borrower',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getParameters',
    inputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IUniswapV3Pool',
      },
    ],
    outputs: [
      { name: 'ante', type: 'uint208', internalType: 'uint208' },
      { name: 'nSigma', type: 'uint8', internalType: 'uint8' },
      {
        name: 'manipulationThresholdDivisor',
        type: 'uint8',
        internalType: 'uint8',
      },
      {
        name: 'pausedUntilTime',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'governMarketConfig',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'contract IUniswapV3Pool',
      },
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct Factory.MarketConfig',
        components: [
          { name: 'ante', type: 'uint208', internalType: 'uint208' },
          { name: 'nSigma', type: 'uint8', internalType: 'uint8' },
          {
            name: 'manipulationThresholdDivisor',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'reserveFactor0',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'reserveFactor1',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'rateModel0',
            type: 'address',
            internalType: 'contract IRateModel',
          },
          {
            name: 'rateModel1',
            type: 'address',
            internalType: 'contract IRateModel',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'governRewardsRate',
    inputs: [
      {
        name: 'lender',
        type: 'address',
        internalType: 'contract Lender',
      },
      { name: 'rate', type: 'uint64', internalType: 'uint64' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'governRewardsToken',
    inputs: [
      {
        name: 'rewardsToken_',
        type: 'address',
        internalType: 'contract ERC20',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isBorrower',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pause',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'contract IUniswapV3Pool',
      },
      { name: 'oracleSeed', type: 'uint40', internalType: 'uint40' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'peer',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'rewardsToken',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract ERC20' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'CreateBorrower',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'contract IUniswapV3Pool',
      },
      {
        name: 'owner',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'account',
        type: 'address',
        indexed: false,
        internalType: 'contract Borrower',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CreateMarket',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'contract IUniswapV3Pool',
      },
      {
        name: 'lender0',
        type: 'address',
        indexed: false,
        internalType: 'contract Lender',
      },
      {
        name: 'lender1',
        type: 'address',
        indexed: false,
        internalType: 'contract Lender',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EnrollCourier',
    inputs: [
      {
        name: 'id',
        type: 'uint32',
        indexed: true,
        internalType: 'uint32',
      },
      {
        name: 'wallet',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'cut',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SetMarketConfig',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'contract IUniswapV3Pool',
      },
      {
        name: 'config',
        type: 'tuple',
        indexed: false,
        internalType: 'struct Factory.MarketConfig',
        components: [
          { name: 'ante', type: 'uint208', internalType: 'uint208' },
          { name: 'nSigma', type: 'uint8', internalType: 'uint8' },
          {
            name: 'manipulationThresholdDivisor',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'reserveFactor0',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'reserveFactor1',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'rateModel0',
            type: 'address',
            internalType: 'contract IRateModel',
          },
          {
            name: 'rateModel1',
            type: 'address',
            internalType: 'contract IRateModel',
          },
        ],
      },
    ],
    anonymous: false,
  },
] as const;
