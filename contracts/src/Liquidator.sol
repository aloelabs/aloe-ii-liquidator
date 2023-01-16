// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// 1st party library imports
import {TickMath} from "aloe-ii-core/libraries/TickMath.sol";

// 1st party contract imports
import {Borrower, ILiquidator} from "aloe-ii-core/Borrower.sol";
import {IUniswapV3SwapCallback} from "v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import {IUniswapV3Pool} from "v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IUniswapV3Factory} from "v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "forge-std/console2.sol";

contract Liquidator is ILiquidator, IUniswapV3SwapCallback {

    address private constant FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;

    function liquidate(Borrower borrower, bytes calldata data, uint256 strain) external {
        borrower.liquidate(this, data, strain);
    }

    function callback0(bytes calldata data, uint256 assets1, uint256 liabilities0) external {
        // have liabilities0, have assets in token 1
        // want to swap token1 for token 0
        Borrower borrower = Borrower(msg.sender);
        bytes memory swapData = abi.encode(borrower);
        borrower.UNISWAP_POOL().swap(msg.sender, false, -int256(liabilities0), TickMath.MAX_SQRT_RATIO - 1, swapData);
    }

    function callback1(bytes calldata data, uint256 assets0, uint256 liabilities1) external {
        Borrower borrower = Borrower(msg.sender);
        bytes memory swapData = abi.encode(borrower);
        borrower.UNISWAP_POOL().swap(msg.sender, true, -int256(liabilities1), TickMath.MIN_SQRT_RATIO + 1, swapData);
    }

     function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) public override {
        address token0 = IUniswapV3Pool(msg.sender).token0();
        address token1 = IUniswapV3Pool(msg.sender).token1();
        uint24 fee = IUniswapV3Pool(msg.sender).fee();
        address pool = IUniswapV3Factory(FACTORY).getPool(token0, token1, fee);
        require(msg.sender == pool, "Caller must be pool");
        // Get the borrower information from the data
        Borrower borrower = abi.decode(data, (Borrower));

        if (amount0Delta > 0) { // We have some amount of token 0 because we swapped for token 1
            // console2.log("token1", borrower.TOKEN1().balanceOf(address(this)));
            borrower.TOKEN0().transfer(msg.sender, uint256(amount0Delta));
        } else if (amount1Delta > 0) {
            // console2.log("token0", borrower.TOKEN0().balanceOf(address(this)));
            borrower.TOKEN1().transfer(msg.sender, uint256(amount1Delta));
        }
    }
}
