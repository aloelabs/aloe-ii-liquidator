export const borrowerLensAbi = [
  {
    type: "function",
    name: "getHealth",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "contract Borrower",
      },
    ],
    outputs: [
      { name: "healthA", type: "uint256", internalType: "uint256" },
      { name: "healthB", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUniswapPositions",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "contract Borrower",
      },
    ],
    outputs: [
      { name: "positions", type: "int24[]", internalType: "int24[]" },
      {
        name: "liquidity",
        type: "uint128[]",
        internalType: "uint128[]",
      },
      { name: "fees", type: "uint256[]", internalType: "uint256[]" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isInUse",
    inputs: [
      {
        name: "borrower",
        type: "address",
        internalType: "contract Borrower",
      },
    ],
    outputs: [
      { name: "", type: "bool", internalType: "bool" },
      {
        name: "",
        type: "address",
        internalType: "contract IUniswapV3Pool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "predictBorrowerAddress",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract IUniswapV3Pool",
      },
      { name: "owner", type: "address", internalType: "address" },
      { name: "salt", type: "bytes12", internalType: "bytes12" },
      { name: "caller", type: "address", internalType: "address" },
      {
        name: "factory",
        type: "address",
        internalType: "contract Factory",
      },
    ],
    outputs: [{ name: "borrower", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
] as const;
