// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// 1st party library imports
import {TickMath} from "aloe-ii-core/libraries/TickMath.sol";

// 1st party contract imports
import {Borrower, ILiquidator} from "aloe-ii-core/Borrower.sol";
import {IUniswapV3SwapCallback} from "v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import {IUniswapV3Pool} from "v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IUniswapV3Factory} from "v3-core/contracts/interfaces/IUniswapV3Factory.sol";

import {ERC20, SafeTransferLib} from "solmate/utils/SafeTransferLib.sol";

contract Liquidator is ILiquidator, IUniswapV3SwapCallback {
    using SafeTransferLib for ERC20;

    receive() external payable {}

    function liquidate(Borrower borrower, bytes calldata data, uint256 strain) external {
        borrower.LENDER0().accrueInterest();
        borrower.LENDER1().accrueInterest();

        try borrower.liquidate(this, data, strain) {}
        catch {
            borrower.warn();
        }
        payable(tx.origin).transfer(address(this).balance);
    }

    function swap1For0(bytes calldata data, uint256 received1, uint256 expected0) external {
        Borrower borrower = Borrower(msg.sender);

        // (uint160 sqrtPriceLimitX96, address rewardRecipient) = abi.decode(data, (uint160, address));
        address rewardRecipient = abi.decode(data, (address));

        // Liabilities in token0, assets in token 1
        // Need to swap token1 for token0
        (, int256 amount1) = borrower.UNISWAP_POOL().swap(
            msg.sender,
            false,
            -int256(expected0),
            TickMath.MAX_SQRT_RATIO - 1,//sqrtPriceLimitX96
            bytes("")
        );

        // transfer to the original caller
        borrower.TOKEN1().safeTransfer(rewardRecipient, received1 - uint256(amount1));
    }

    function swap0For1(bytes calldata data, uint256 received0, uint256 expected1) external {
        Borrower borrower = Borrower(msg.sender);

        // (uint160 sqrtPriceLimitX96, address rewardRecipient) = abi.decode(data, (uint160, address));
        address rewardRecipient = abi.decode(data, (address));

        // Liabilities in token1, assets in token 0
        // Need to swap token0 for token1
        (int256 amount0, ) = borrower.UNISWAP_POOL().swap(
            msg.sender,
            true,
            -int256(expected1),
            TickMath.MIN_SQRT_RATIO + 1,//sqrtPriceLimitX96
            bytes("")
        );

        // transfer to the original caller
        borrower.TOKEN0().safeTransfer(rewardRecipient, received0 - uint256(amount0));
    }

     function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) public override {
        if (amount0Delta > 0) {
            ERC20(IUniswapV3Pool(msg.sender).token0()).safeTransfer(msg.sender, uint256(amount0Delta));
        } else {
            ERC20(IUniswapV3Pool(msg.sender).token1()).safeTransfer(msg.sender, uint256(amount1Delta));
        }
    }
}
