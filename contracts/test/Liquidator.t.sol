// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "v3-core/contracts/interfaces/IUniswapV3Pool.sol";

// 1st party contract imports
import {ERC20} from "solmate/utils/SafeTransferLib.sol";
import {Borrower, IManager} from "aloe-ii-core/Borrower.sol";
import {Factory} from "aloe-ii-core/Factory.sol";
import {Lender} from "aloe-ii-core/Lender.sol";
import {Uniswap} from "aloe-ii-core/libraries/Uniswap.sol";
import {RateModel} from "aloe-ii-core/RateModel.sol";
import {TickMath} from "aloe-ii-core/libraries/TickMath.sol";
import "./Utils.sol";

import "../src/Liquidator.sol";

contract LiquidatorTest is Test, IManager {

    // DAI/USDC pool (easy because 1 DAI = 1 USDC)
    IUniswapV3Pool constant pool = IUniswapV3Pool(0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168);
    ERC20 constant asset0 = ERC20(0x6B175474E89094C44Da98b954EedeAC495271d0F); // DAI
    ERC20 constant asset1 = ERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48); // USDC

    Borrower public account;
    Liquidator public liquidator;

    Factory public factory; 

    Lender public lender0;
    Lender public lender1;

    constructor() {
    }

    function setUp() public {
        vm.createSelectFork(vm.envString("MAINNET_RPC_URL"));
        vm.rollFork(15_348_451);
        factory = new Factory(new RateModel());

        factory.createMarket(pool);
        liquidator = new Liquidator(factory);
        (lender0, lender1, ) = factory.getMarket(pool);
        account = Borrower(factory.createBorrower(pool, address(this)));
        console.log(account.owner());
    }

    function callback(bytes calldata data)
        external
        returns (Uniswap.Position[] memory positions, bool includeLenderReceipts)
    {
        (uint128 borrow0, uint128 borrow1, uint128 repay0, uint128 repay1, uint256 withdraw0, uint256 withdraw1) = abi
            .decode(data, (uint128, uint128, uint128, uint128, uint256, uint256));
        Borrower _account = Borrower(msg.sender);
        console.log(_account.owner());
        
        if (borrow0 != 0 || borrow1 != 0) {
            _account.borrow(borrow0, borrow1, msg.sender);
        }
        if (repay0 != 0 || repay1 != 0) {
            _account.repay(repay0, repay1);
        }
        if (withdraw0 != 0) asset0.transferFrom(msg.sender, address(this), withdraw0);
        if (withdraw1 != 0) asset1.transferFrom(msg.sender, address(this), withdraw1);
    }

    function test_liquidationDoesNotOccur() public {
        _prepareKitties();
        // Add tokens to contract
        deal(address(asset0), address(this), 10e6);
        deal(address(asset1), address(this), 1e17);
        // Add Margin
        asset0.transfer(address(account), 10e6);
        asset1.transfer(address(account), 1e17);

        bytes memory data = abi.encode(100e6, 1e18, 0, 0, 0, 0);
        bool[4] memory allowances;
        console.log("About to call modify");
        account.modify(this, data, allowances);

        assertEq(lender0.borrowBalance(address(account)), 100e6);
        assertEq(lender1.borrowBalance(address(account)), 1e18);
        assertEq(asset0.balanceOf(address(account)), 10e6 + 100e6);
        assertEq(asset1.balanceOf(address(account)), 1e17 + 1e18);
        vm.expectRevert("Liquidate failed to transfer ownership");
        liquidator.liquidate(account);
    }

    function test_liquidationOccurs_LenderAccuresInterest() public {
        _prepareKitties();
        // Add tokens to contract
        deal(address(asset0), address(this), 10e6);
        deal(address(asset1), address(this), 1e17);

        // Add Margin
        asset0.transfer(address(account), 10e6);
        asset1.transfer(address(account), 1e17);

        bytes memory data = abi.encode(100e6, 1e18, 0, 0, 0, 0);
        bool[4] memory allowances;
        account.modify(this, data, allowances);

        assertEq(lender0.borrowBalance(address(account)), 100e6);
        assertEq(lender1.borrowBalance(address(account)), 1e18);
        assertEq(asset0.balanceOf(address(account)), 10e6 + 100e6);
        assertEq(asset1.balanceOf(address(account)), 1e17 + 1e18);

        skip(86400); // seconds

        uint256 liabilities0 = lender0.borrowBalance(address(account));
        uint256 liabilities1 = lender1.borrowBalance(address(account));
        uint256 assets0 = asset0.balanceOf(address(account));
        uint256 assets1 = asset1.balanceOf(address(account));

        bytes memory data_two = abi.encode(
            0,
            0,
            0,
            0,
            assets0 - ((liabilities0 * 1.005e8) / 1e8),
            assets1 - ((liabilities1 * 1.005e8) / 1e8)
        );
        bool[4] memory allowances_two;
        allowances_two[0] = true;
        allowances_two[1] = true;
        account.modify(this, data_two, allowances_two);

        skip(86400);
        lender0.accrueInterest();
        lender1.accrueInterest();

        console.log("Lender accured interest");
        liquidator.liquidate(account);
    }

    function test_liquidationOccurs_ExchangeRateDrops() public {
        _prepareKitties();

        // Add tokens to contract
        deal(address(asset0), address(this), 10e6);
        deal(address(asset1), address(this), 1e17);

        // Add Margin
        asset0.transfer(address(account), 10e6);
        asset1.transfer(address(account), 1e17);

        bytes memory data = abi.encode(100e6, 1e18, 0, 0, 0, 0);
        bool[4] memory allowances;
        account.modify(this, data, allowances);

        assertEq(lender0.borrowBalance(address(account)), 100e6);
        assertEq(lender1.borrowBalance(address(account)), 1e18);
        assertEq(asset0.balanceOf(address(account)), 10e6 + 100e6);
        assertEq(asset1.balanceOf(address(account)), 1e17 + 1e18);

        skip(86400); // seconds

        uint256 liabilities0 = lender0.borrowBalance(address(account));
        uint256 liabilities1 = lender1.borrowBalance(address(account));
        uint256 assets0 = asset0.balanceOf(address(account));
        uint256 assets1 = asset1.balanceOf(address(account));

        bytes memory data_two = abi.encode(
            0,
            0,
            0,
            0,
            assets0 - ((liabilities0 * 1.005e8) / 1e8),
            assets1 - ((liabilities1 * 1.005e8) / 1e8)
        );
        bool[4] memory allowances_two;
        allowances_two[0] = true;
        allowances_two[1] = true;
        account.modify(this, data_two, allowances_two);

        skip(86400);
        bytes calldata mocked_data = abi.encodeCall(TickMath.getSqrtRatioAtTick, (int24(5)));
        bytes calldata mocked_return_data = abi.encode(uint160(2));
        vm.mockCall(0x1F98431c8aD98523631AE4a59f267346ea31F984, mocked_data, mocked_return_data);

        liquidator.liquidate(account);
    }

    function _prepareKitties() private {
        address alice = makeAddr("alice");

        deal(address(asset0), address(lender0), 10000e6);
        lender0.deposit(10000e6, alice);

        deal(address(asset1), address(lender1), 3e18);
        lender1.deposit(3e18, alice);
    }
}