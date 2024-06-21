import { describe, expect, test } from '@jest/globals';

import { createTestClient, http, publicActions, walletActions, encodeFunctionData, PublicClient, GetContractReturnType, parseEther, zeroAddress } from 'viem';
import { foundry, optimism } from 'viem/chains';
import { createAnvil } from '@viem/anvil';
import { getBorrowerContract, getERC20Contract, setupViemTestClient } from './Contracts';
import { getBorrowers, getSlot0, canWarn } from './Liquidator';
import { borrowerAbi } from './abis/Borrower';
import { borrowerLensAbi } from './abis/BorrowerLens';

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

const anvil = createAnvil({
  forkUrl: 'https://opt-mainnet.g.alchemy.com/v2/yQdMiWQFPhgEk9AoQ72DZMbmX8vBT81U',
  forkBlockNumber: 119812542n,
  startTimeout: 50_000,
});

const Q32 = 0x100000000

// // Setup anvil server
beforeAll(async () => {
  await anvil.start();
}, 10000);

afterAll(async () => {
  await anvil.stop();
}, 10000);

test('test get borrowers function', async () => {
  // We're running on optimism, so just get the optimism factory
  const { client, factory, borrowerLens } = setupViemTestClient("0x000000009efdB26b970bCc0085E126C9dfc16ee8", "0xF8686eafF7106Fa6b6337b4FB767557E73299Aa0");
  // Note: if you pass 0n for blockNumber to getBorrowers, you get borrowers that are not in use 
  const borrowers = await getBorrowers(factory, 116043617n)
  console.log(borrowers)
  expect(borrowers.length).toBeGreaterThan(0n)
});

test('getSlot0 returns non-null value', async () => {
    // get a random borrower
    const { client, factory, borrowerLens } = setupViemTestClient("0x000000009efdB26b970bCc0085E126C9dfc16ee8", "0xF8686eafF7106Fa6b6337b4FB767557E73299Aa0");
    // Note: if you pass 0n for blockNumber to getBorrowers, you get borrowers that are not in use 
    // const borrowers = await getBorrowers(factory, 116043617n)
    const borrowers = await getBorrowers(factory, 117037797n)
    const borrower = borrowers[Math.floor(Math.random() * borrowers.length)]
    // const slot0 = await getSlot0("0x830b136457D991Cd17638ad400E821c1867d5F00", client)
    const slot0 = await getSlot0(borrower, client)
    expect(slot0).not.toBeNull()
});

test('making a borrower unhealthy', async () => {
    // get a random borrower
    const { client, factory, borrowerLens } = setupViemTestClient("0x000000009efdB26b970bCc0085E126C9dfc16ee8", "0xF8686eafF7106Fa6b6337b4FB767557E73299Aa0");
    // Note: if you pass 0n for blockNumber to getBorrowers, you get borrowers that are not in use 
    const borrowers = await getBorrowers(factory, 117037797n)
    const borrowersWithoutUniswapPositions = borrowers.filter(async (borrower) => {
        const uniswapPositions = await borrowerLens.read.getUniswapPositions([borrower]);
        return uniswapPositions[0].length == 0
    })
    const simpleManagerAddress: `0x${string}` = `0xBb5A35B80b15A8E5933fDC11646A20f6159Dd061`
    // const randomIndex = Math.floor(Math.random()*borrowersWithoutUniswapPositions.length)
    // const borrower = borrowersWithoutUniswapPositions[randomIndex]
    const borrower = "0x9b8D2F8D2f26BEE169CfEFB7505b7d242a91c756"
    console.log('borrower', borrower)
    // const borrower = `0xCD9f48a37922812D0CC610dB019Fbc09117142da`


    const borrowerContract = getBorrowerContract(borrower, client)
    const owner = await borrowerContract.read.owner();
    const token0 = await borrowerContract.read.TOKEN0();
    const token1 = await borrowerContract.read.TOKEN1();
    const liabilities = await borrowerContract.read.getLiabilities();

    const erc20Token0Contract = getERC20Contract(token0, client)
    const erc20Token1Contract = getERC20Contract(token1, client)

    const balanceToken0 = await erc20Token0Contract.read.balanceOf([borrower]);
    const balanceToken1 = await erc20Token1Contract.read.balanceOf([borrower]);

    const prices = await borrowerContract.read.getPrices([1 << 32])
    const currentSqrtPrice = prices[0].c
    const borrowAmount1 = computeLiquidatableBorrowerAmountToken1(
        balanceToken0,
        balanceToken1,
        liabilities[0],
        liabilities[1],
        currentSqrtPrice
    )
    console.log("before currentSqrtPrice", currentSqrtPrice)
    console.log(borrowAmount1)

    // Need to get the hashed contract code
    const borrowEncodedData = encodeFunctionData({
        abi: borrowerAbi,
        functionName: "borrow",
        args: [0n, borrowAmount1, owner]
    })

    // 0x9b8D2F8D2f26BEE169CfEFB7505b7d242a91c756
    const modifyEncodedData = encodeFunctionData({
        abi: borrowerAbi,
        functionName: "modify",
        args: [simpleManagerAddress, borrowEncodedData, Q32]
    })

    const [healthABefore, healthBBefore] = await borrowerLens.read.getHealth([borrower])
    const healthDivisor = 100000000000000n
    console.log("healthA before", Number(healthABefore / healthDivisor) / 1e4, "healthB before", Number(healthBBefore / healthDivisor) / 1e4)

    await client.impersonateAccount({ // Impersonate the borrower's owner
        address: owner
    })

    await client.setBalance({
        address: owner,
        value: parseEther('500')
    })

    const hash = await client.sendTransaction({
        chain: optimism,
        account: owner,
        to: borrower,
        data: modifyEncodedData, 
    })

    await client.stopImpersonatingAccount({
        address: owner
    })

    await client.mine({
        blocks: 1,
    })
    const block = await client.getBlock({
        blockNumber: 119812542n,
    })

    console.log("block", block)

    await client.setNextBlockTimestamp({
        timestamp: 1746752690n
    })

    await client.mine({
        blocks: 1,
    })

    const transaction = await client.getTransactionReceipt({ 
        hash: hash,
    })

    const newPrices = await borrowerContract.read.getPrices([1 << 32])
    const newCurrentSqrtPrice = newPrices[0].c

    console.log("newPrices", newCurrentSqrtPrice)

    console.log(transaction)
    
    const [healthA, healthB] = await borrowerLens.read.getHealth([borrower])
    // const healthDivisor = 100000000000000n
    console.log("healthA", Number(healthA / healthDivisor) / 1e4, "healthB", Number(healthB / healthDivisor) / 1e4)

}, 100_000);

describe('testing canWarn', () => {
    test('slot0 for borrower that hasn\'t been warned', () => {
        expect(canWarn(57896044618658097711785541865770234428549607255112979763536672588146440929280n)).toBeTruthy()
    });
    test('slot0 for borrower that has been warned', () => {
        expect(canWarn(108555083659983933209597847807071194114355225546330726530799365591608435146752n)).toBeFalsy()
    });
})

function computeLiquidatableBorrowerAmountToken1(
    balanceToken0: bigint,
    balanceToken1: bigint,
    liabilities0: bigint,
    liabilities1: bigint,
    sqrtPrice: bigint
): bigint {
    // 0.9e12
    // const ltvMax = 900000000000n
    const ltvMax = 674900000000n
    // 1e12
    const divisor = 1000000000000n 
    const priceX128 = (sqrtPrice * sqrtPrice) / (1n << 64n)
    console.log("balanceToken0", balanceToken0, "balanceToken1", balanceToken1)
    console.log("liabilities0", liabilities0, "liabilities1", liabilities1)
    // Convert balanceToken0 to units in terms of token1
    const convertedBalanceToken0 = balanceToken0 * priceX128 / (1n << 128n)
    console.log(convertedBalanceToken0)
    const collateralToken1 = balanceToken1 + convertedBalanceToken0
    console.log('collateralToken1', collateralToken1)
    const maxBorrowToken1 = (collateralToken1 * ltvMax) / divisor
    console.log('maxBorrow', maxBorrowToken1)
    const convertedLiabilities0 = liabilities0 * priceX128 / (1n << 128n)
    const totalLiabilities1 = convertedLiabilities0 + liabilities1
    console.log('totalLiabilities1', totalLiabilities1)
    const borrowAmountToken1 = maxBorrowToken1 - totalLiabilities1
    if (borrowAmountToken1 < 0n) {
        return 0n
    }
    return borrowAmountToken1
}