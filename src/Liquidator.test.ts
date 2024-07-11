import { describe, expect, test } from '@jest/globals';

import {
  encodeFunctionData,
  parseEther,
  getContract,
  toHex,
  Hex,
} from 'viem';
import { foundry, optimism } from 'viem/chains';
import { createAnvil } from '@viem/anvil';
import { getBorrowerContract, getERC20Contract, setupViemTestClient } from './Contracts';
import { getBorrowers, getSlot0, canWarn } from './Liquidator';
import { borrowerAbi } from './abis/Borrower';
import { borrowerLensAbi } from './abis/BorrowerLens';
import { lenderAbi } from './abis/Lender';

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const FORK_BLOCK_NUMBER = 119812542n;

const anvil = createAnvil({
  forkUrl: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  forkBlockNumber: FORK_BLOCK_NUMBER,
  startTimeout: 50_000,
});

const Q32 = 0x100000000;

// // Setup anvil server
beforeAll(async () => {
  await anvil.start();
}, 10000);

afterAll(async () => {
  await anvil.stop();
}, 10000);

test('test get borrowers function', async () => {
  // We're running on optimism, so just get the optimism factory
  const { client, factory, borrowerLens } = setupViemTestClient(
    '0x000000009efdB26b970bCc0085E126C9dfc16ee8',
    '0xF8686eafF7106Fa6b6337b4FB767557E73299Aa0'
  );
  // Note: if you pass 0n for blockNumber to getBorrowers, you get borrowers that are not in use
  const borrowers = await getBorrowers(factory, 116043617n);
  console.log(borrowers);
  expect(borrowers.length).toBeGreaterThan(0n);
});

test('getSlot0 returns non-null value', async () => {
  // get a random borrower
  const { client, factory, borrowerLens } = setupViemTestClient(
    '0x000000009efdB26b970bCc0085E126C9dfc16ee8',
    '0xF8686eafF7106Fa6b6337b4FB767557E73299Aa0'
  );
  // Note: if you pass 0n for blockNumber to getBorrowers, you get borrowers that are not in use
  // const borrowers = await getBorrowers(factory, 116043617n)
  const borrowers = await getBorrowers(factory, 117037797n);
  const borrower = borrowers[Math.floor(Math.random() * borrowers.length)];
  // const slot0 = await getSlot0("0x830b136457D991Cd17638ad400E821c1867d5F00", client)
  const slot0 = await getSlot0(borrower, client);
  expect(slot0).not.toBeNull();
});

test('making a borrower unhealthy', async () => {
  // get a random borrower
  const { client, factory, borrowerLens } = setupViemTestClient(
    '0x000000009efdB26b970bCc0085E126C9dfc16ee8',
    '0xF8686eafF7106Fa6b6337b4FB767557E73299Aa0'
  );
  const args = { blockNumber: FORK_BLOCK_NUMBER };
  // Note: if you pass 0n for blockNumber to getBorrowers, you get borrowers that are not in use
  // const borrowers = await getBorrowers(factory, 117037797n);
  // const borrowersWithoutUniswapPositions = borrowers.filter(async (borrower) => {
  //   const uniswapPositions = await borrowerLens.read.getUniswapPositions([borrower]);
  //   return uniswapPositions[0].length == 0;
  // });
  const simpleManagerAddress: `0x${string}` = `0xBb5A35B80b15A8E5933fDC11646A20f6159Dd061`;
  // const randomIndex = Math.floor(Math.random()*borrowersWithoutUniswapPositions.length)
  // const borrower = borrowersWithoutUniswapPositions[randomIndex]
  const borrower = '0x9b8D2F8D2f26BEE169CfEFB7505b7d242a91c756';
  // const borrower = `0xCD9f48a37922812D0CC610dB019Fbc09117142da`

  console.log('Borrower to target:', borrower);

  const borrowerContract = getBorrowerContract(borrower, client);
  const owner = await borrowerContract.read.owner(args);
  const token0 = await borrowerContract.read.TOKEN0(args);
  const token1 = await borrowerContract.read.TOKEN1(args);
  const liabilities = await borrowerContract.read.getLiabilities(args);

  const erc20Token0Contract = getERC20Contract(token0, client);
  const erc20Token1Contract = getERC20Contract(token1, client);

  const balanceToken0 = await erc20Token0Contract.read.balanceOf([borrower], args);
  const balanceToken1 = await erc20Token1Contract.read.balanceOf([borrower], args);

  const prices = await borrowerContract.read.getPrices([1 << 32], args);
  const currentSqrtPrice = prices[0].c;
  const borrowAmount1 = computeLiquidatableBorrowerAmountToken1(
    balanceToken0,
    balanceToken1,
    liabilities[0],
    liabilities[1],
    currentSqrtPrice
  );

  const healthDivisor = 1000000000n;
  let healthA: bigint, healthB: bigint;
  [healthA, healthB] = await borrowerLens.read.getHealth([borrower], args);

  console.log('Pre-transaction state');
  console.log('\tblock number:', await client.getBlockNumber());
  console.log('\tcurrent sqrtPrice:', currentSqrtPrice);
  console.log('\testimated borrow amount to become unhealthy:', borrowAmount1);
  console.log('\thealthA', Number(healthA / healthDivisor) / 1e9, 'healthB', Number(healthB / healthDivisor) / 1e9);

  // Need to get the hashed contract code
  const borrowEncodedData = encodeFunctionData({
    abi: borrowerAbi,
    functionName: 'borrow',
    args: [0n, borrowAmount1, owner],
  });

  // 0x9b8D2F8D2f26BEE169CfEFB7505b7d242a91c756
  const modifyEncodedData = encodeFunctionData({
    abi: borrowerAbi,
    functionName: 'modify',
    args: [simpleManagerAddress, borrowEncodedData, Q32],
  });

  await client.impersonateAccount({
    // Impersonate the borrower's owner
    address: owner,
  });

  await client.setBalance({
    address: owner,
    value: parseEther('500'),
  });

  const hash = await client.sendTransaction({
    chain: optimism,
    account: owner,
    to: borrower,
    data: modifyEncodedData,
  });
  const transaction = await client.getTransactionReceipt({ hash });

  console.log('\n\n------- RECEIPT -------');
  console.log(transaction);
  console.log('-----------------------\n\n');

  await client.stopImpersonatingAccount({
    address: owner,
  });

  args.blockNumber += 1n;

  console.log('Post-transaction state');
  [healthA, healthB] = await borrowerLens.read.getHealth([borrower], args);
  console.log('\thealthA', Number(healthA / healthDivisor) / 1e9, 'healthB', Number(healthB / healthDivisor) / 1e9);

  // Now we manually increase borrowIndex to mock interest accrual and make the borrower unhealthy
  const lender1 = await borrowerContract.read.LENDER1(args);
  const lender1Contract = getContract({ address: lender1, abi: lenderAbi, client });

  const borrowIndex = await lender1Contract.read.borrowIndex(args);
  const borrowIndexUpdated = (borrowIndex * 102n) / 100n; // mock interest accrual of +2%

  const slot1 = BigInt((await client.getStorageAt({ address: lender1, slot: toHex(1) })) as Hex);
  const slot1Updated = (slot1 % (1n << 184n)) + (borrowIndexUpdated << 184n);

  const slot1Hex = `0x${slot1.toString(16).padStart(64, '0')}` as Hex;
  const slot1HexUpdated = `0x${slot1Updated.toString(16).padStart(64, '0')}` as Hex;
  await client.setStorageAt({ address: lender1, index: toHex(1), value: slot1HexUpdated });

  const borrowIndexVerified = await lender1Contract.read.borrowIndex(args);

  console.log('\nMOCKING INTEREST ACCRUAL');
  console.log('\t(A) borrowIndex:', borrowIndex);
  console.log('\t(A) slot1:', slot1Hex);
  console.log('\t(B) slot1:', slot1HexUpdated);
  console.log('\t(B) borrowIndex:', borrowIndexVerified, '( expected', borrowIndexUpdated, ')\n');

  console.log('Post-interest-accrual state');
  [healthA, healthB] = await borrowerLens.read.getHealth([borrower], args);
  console.log('\thealthA', Number(healthA / healthDivisor) / 1e9, 'healthB', Number(healthB / healthDivisor) / 1e9);
}, 100_000);

describe('testing canWarn', () => {
  test("slot0 for borrower that hasn't been warned", () => {
    expect(canWarn(57896044618658097711785541865770234428549607255112979763536672588146440929280n)).toBeTruthy();
  });
  test('slot0 for borrower that has been warned', () => {
    expect(canWarn(108555083659983933209597847807071194114355225546330726530799365591608435146752n)).toBeFalsy();
  });
});

function computeLiquidatableBorrowerAmountToken1(
  balanceToken0: bigint,
  balanceToken1: bigint,
  liabilities0: bigint,
  liabilities1: bigint,
  sqrtPrice: bigint
): bigint {
  // 0.9e12
  // const ltvMax = 900000000000n
  const ltvMax = 674900000000n;
  // 1e12
  const divisor = 1000000000000n;
  const priceX128 = (sqrtPrice * sqrtPrice) / (1n << 64n);
  console.log('balanceToken0', balanceToken0, 'balanceToken1', balanceToken1);
  console.log('liabilities0', liabilities0, 'liabilities1', liabilities1);
  // Convert balanceToken0 to units in terms of token1
  const convertedBalanceToken0 = (balanceToken0 * priceX128) / (1n << 128n);
  console.log(convertedBalanceToken0);
  const collateralToken1 = balanceToken1 + convertedBalanceToken0;
  console.log('collateralToken1', collateralToken1);
  const maxBorrowToken1 = (collateralToken1 * ltvMax) / divisor;
  console.log('maxBorrow', maxBorrowToken1);
  const convertedLiabilities0 = (liabilities0 * priceX128) / (1n << 128n);
  const totalLiabilities1 = convertedLiabilities0 + liabilities1;
  console.log('totalLiabilities1', totalLiabilities1);
  const borrowAmountToken1 = maxBorrowToken1 - totalLiabilities1;
  if (borrowAmountToken1 < 0n) {
    return 0n;
  }
  return borrowAmountToken1;
}
