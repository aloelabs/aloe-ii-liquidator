// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {IUniswapV3SwapCallback} from "v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import {IUniswapV3Pool} from "v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IUniswapV3Factory} from "v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {ERC20, SafeTransferLib} from "solmate/utils/SafeTransferLib.sol";
import {Borrower} from "aloe-ii-core/Borrower.sol";
import "forge-std/console.sol";

contract LiquidationCallee is IUniswapV3SwapCallback {
    using SafeTransferLib for ERC20;

    address private constant FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;

     function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) public override {
        address token0 = IUniswapV3Pool(msg.sender).token0();
        address token1 = IUniswapV3Pool(msg.sender).token1();
        uint24 fee = IUniswapV3Pool(msg.sender).fee();
        address pool = IUniswapV3Factory(FACTORY).getPool(token0, token1, fee);
        require(msg.sender == pool, "Caller must be pool");
        console.log("Into the callback");
        // Get the borrower information from the data
        address borrowerAddress = abi.decode(data, (address));

        Borrower borrower = Borrower(borrowerAddress);

        uint256 loanAmount = amount0Delta != 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        console.log("hello");

        // Need to pay back the flash swap
        uint256 feeAmount = ((loanAmount * 3) / 997) + 1;
        uint256 amountToRepay = loanAmount + feeAmount;
        console.log("all computations done");
        if (amount0Delta > 0) { // We have some amount of token 0 because we swapped for token 1
            console.log("About to attempt token transfer");
            borrower.TOKEN1().approve(address(this), amountToRepay);
            borrower.TOKEN1().transferFrom(address(borrower), msg.sender, amountToRepay);
        } else if (amount1Delta > 0) {
            console.log("going to try transferring token0");
            borrower.TOKEN0().approve(address(this), amountToRepay);
            borrower.TOKEN0().transferFrom(address(borrower), msg.sender, amountToRepay);
        }
    }
}