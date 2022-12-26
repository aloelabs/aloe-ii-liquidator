// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// 3rd party imports
import {ERC20, SafeTransferLib} from "solmate/utils/SafeTransferLib.sol";
import {IUniswapV3Pool} from "v3-core/contracts/interfaces/IUniswapV3Pool.sol";

// 1st party library imports
import {Uniswap} from "aloe-ii-core/libraries/Uniswap.sol";

// 1st party contract imports
import {Borrower, IManager} from "aloe-ii-core/Borrower.sol";
import {Factory} from "aloe-ii-core/Factory.sol";
import {Lender} from "aloe-ii-core/Lender.sol";

contract Liquidator is IManager {
    using SafeTransferLib for ERC20;

    Factory public immutable FACTORY;

    constructor(Factory factory) {
        FACTORY = factory;
    }

    function liquidate(Borrower borrower) external {
        // If the borrower is insolvent, calling `liquidate` will give this contract
        // ownership of the `borrower`. Otherwise reverts.
        borrower.liquidate();

        // Now that this contract has ownership, it's allowed to call `modify`. If all goes well,
        // control flow will move to the `callback` down below
        bool[4] memory allowances; // TODO probably set indices 3 and 4 to true.
        borrower.modify(this, "", allowances);
    }

    function callback(bytes calldata data)
        external
        override
        returns (Uniswap.Position[] memory positions, bool includeLenderReceipts)
    {
        // MARK: PREPARATION ------------------------------------------------------------------------------------------

        // This is an external function, meaning that anybody can call it. To be safe, we want to make sure that
        // the caller is actually a borrower.
        require(FACTORY.isBorrower(msg.sender));

        // Create account variable so that we don't have to re-cast `msg.sender` every time
        Borrower account = Borrower(msg.sender);

        // Also fetch and store some other stuff that we'll use frequently
        IUniswapV3Pool pool = account.UNISWAP_POOL();
        ERC20 token0 = account.TOKEN0();
        ERC20 token1 = account.TOKEN1();
        Lender lender0 = account.LENDER0();
        Lender lender1 = account.LENDER1();

        // Get the borrower's current Uniswap positions
        positions = account.getUniswapPositions();
        uint256 numPositions = positions.length;

        // MARK: SUMMING ASSETS AND LIABILITIES -----------------------------------------------------------------------

        // Initialize assets to just be the raw token balance of the borrower
        uint256 assets0 = token0.balanceOf(msg.sender);
        uint256 assets1 = token1.balanceOf(msg.sender);

        // Withdraw all liquidity from all Uniswap positions
        for (uint256 i = 0; i < numPositions;) {
            Uniswap.Position memory position = positions[i];

            // Query the Uniswap pool to find out how much liquidity is in the position
            bytes32 key = keccak256(abi.encodePacked(msg.sender, position.lower, position.upper));
            (uint128 liquidity,,,,) = pool.positions(key);

            // Withdraw all of the liquidity
            (uint256 burned0, uint256 burned1, uint256 collected0, uint256 collected1) =
                account.uniswapWithdraw(position.lower, position.upper, liquidity);

            unchecked {
                assets0 += burned0 + collected0;
                assets1 += burned1 + collected1;
                i++;
            }
        }

        // If borrower has +Tokens, include them in our assets computation
        (, includeLenderReceipts, , ) = account.packedSlot();
        if (includeLenderReceipts) {
            assets0 += lender0.underlyingBalanceStored(msg.sender);
            assets1 += lender1.underlyingBalanceStored(msg.sender);
        }

        // At this point, we have a full accounting of assets. Next we need a full accounting of
        // liabilities, which is much easier to get:
        uint256 liabilities0 = lender0.borrowBalanceStored(msg.sender);
        uint256 liabilities1 = lender1.borrowBalanceStored(msg.sender);

        // MARK: REPAYING DEBT ----------------------------------------------------------------------------------------

        bool needMoreToken0 = assets0 < liabilities0;
        bool needMoreToken1 = assets1 < liabilities1;

        if (needMoreToken0 && needMoreToken1) {
            // TODO -- If this happens, the account is truly insolvent and the protocol
            // is unhealthy. Not much we can do about it; probably just throw an informative error.
        } else if (needMoreToken0) {
            // TODO swap {N} units of token1 for {liabilities0 - assets0} units of token0
            // This will require you to call pool.swap(...) and implement a UniswapV3SwapCallback
            // that transfers token1 from `account` to `pool`. Note that `token0.transferFrom` will
            // only work if the allowances array is true at index 3.
            // Also, the swap recipient should be msg.sender.
        } else {
            // TODO swap {N} units of token0 for (liabilities1 - assets1) units of token1
            // This will require you to call pool.swap(...) and implement a UniswapV3SwapCallback
            // that transfers token0 from `account` to `pool`. Note that `token1.transferFrom` will
            // only work if the allowances array is true at index 4.
            // Also, the swap recipient should be msg.sender.
        }

        account.repay(liabilities0, liabilities1);
    }
}
