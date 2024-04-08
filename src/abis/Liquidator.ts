export const liquidatorAbi = [
  { type: "receive", stateMutability: "payable" },
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
      { name: "strain", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "swap0For1",
    inputs: [
      { name: "data", type: "bytes", internalType: "bytes" },
      { name: "received0", type: "uint256", internalType: "uint256" },
      { name: "expected1", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "swap1For0",
    inputs: [
      { name: "data", type: "bytes", internalType: "bytes" },
      { name: "received1", type: "uint256", internalType: "uint256" },
      { name: "expected0", type: "uint256", internalType: "uint256" },
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
