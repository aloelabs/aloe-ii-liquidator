export const liquidatorAbi = [
  { type: "receive", stateMutability: "payable" },
  {
    type: "function",
    name: "callback",
    inputs: [
      { name: "data", type: "bytes", internalType: "bytes" },
      { name: "", type: "address", internalType: "address" },
      {
        name: "amounts",
        type: "tuple",
        internalType: "struct AuctionAmounts",
        components: [
          { name: "out0", type: "uint256", internalType: "uint256" },
          { name: "out1", type: "uint256", internalType: "uint256" },
          { name: "repay0", type: "uint256", internalType: "uint256" },
          { name: "repay1", type: "uint256", internalType: "uint256" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "canLiquidate",
    inputs: [
      {
        name: "borrower",
        type: "address",
        internalType: "contract Borrower",
      },
    ],
    outputs: [
      { name: "", type: "bool", internalType: "bool" },
      { name: "", type: "int256", internalType: "int256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "canWarn",
    inputs: [
      {
        name: "borrower",
        type: "address",
        internalType: "contract Borrower",
      },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "liquidate",
    inputs: [
      {
        name: "borrower",
        type: "address",
        internalType: "contract Borrower",
      },
      { name: "data", type: "bytes", internalType: "bytes" },
      { name: "closeFactor", type: "uint256", internalType: "uint256" },
      { name: "oracleSeed", type: "uint40", internalType: "uint40" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "uniswapV3SwapCallback",
    inputs: [
      { name: "amount0Delta", type: "int256", internalType: "int256" },
      { name: "amount1Delta", type: "int256", internalType: "int256" },
      { name: "", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
