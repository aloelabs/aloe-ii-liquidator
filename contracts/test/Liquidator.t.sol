// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "forge-std/Test.sol";
import "v3-core/contracts/interfaces/IUniswapV3Pool.sol";

// 1st party contract imports
import {ERC20} from "solmate/utils/SafeTransferLib.sol";
import {Borrower, IManager} from "aloe-ii-core/Borrower.sol";
import {Factory} from "aloe-ii-core/Factory.sol";
import {Lender} from "aloe-ii-core/Lender.sol";
import {Uniswap} from "aloe-ii-core/libraries/Uniswap.sol";
import {RateModel} from "aloe-ii-core/RateModel.sol";
import "./Utils.sol";

import "../src/Liquidator.sol";

contract LiquidatorTest is Test, IManager {

    Factory public immutable factory; 

    IUniswapV3Pool constant pool = IUniswapV3Pool(0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640);
    ERC20 constant asset0 = ERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    ERC20 constant asset1 = ERC20(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

    Lender public lender0;
    Lender public lender1;
    Borrower public account;
    Liquidator public liquidator;

    constructor() {
        factory = new Factory(new RateModel());
        liquidator = new Liquidator(factory);
    }

    function setUp() public {
        vm.createSelectFork(vm.envString("MAINNET_RPC_URL"));
        vm.rollFork(15_348_451);

        lender0 = deploySingleLender(asset0, address(this), new RateModel());
        lender1 = deploySingleLender(asset1, address(this), new RateModel());
        account = new Borrower(pool, lender0, lender1);
        account.initialize(address(this));
        lender0.whitelist(address(account));
        lender1.whitelist(address(account));
    }

    function callback(bytes calldata data)
        external
        returns (Uniswap.Position[] memory positions, bool includeLenderReceipts)
    {
        Borrower _account = Borrower(msg.sender);
        (uint128 borrow0, uint128 borrow1, uint128 repay0, uint128 repay1, uint256 withdraw0, uint256 withdraw1) = abi
            .decode(data, (uint128, uint128, uint128, uint128, uint256, uint256));

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
        account.modify(this, data, allowances);

        assertEq(lender0.borrowBalance(address(account)), 100e6);
        assertEq(lender1.borrowBalance(address(account)), 1e18);
        assertEq(asset0.balanceOf(address(account)), 10e6 + 100e6);
        assertEq(asset1.balanceOf(address(account)), 1e17 + 1e18);
        // vm.expectRevert();
        liquidator.liquidate(account);
    }

    // function test_liquidationOccurs() public {
    //     _prepareKitties();
    //     // Add tokens to contract
    //     deal(address(asset0), address(this), 10e6);
    //     deal(address(asset1), address(this), 1e17);

    //     // Add Margin
    //     asset0.transfer(address(account), 10e6);
    //     asset1.transfer(address(account), 1e17);

    //     bytes memory data = abi.encode(100e6, 1e18, 0, 0, 0, 0);
    //     bool[4] memory allowances;
    //     account.modify(this, data, allowances);

    //     assertEq(lender0.borrowBalance(address(account)), 100e6);
    //     assertEq(lender1.borrowBalance(address(account)), 1e18);
    //     assertEq(asset0.balanceOf(address(account)), 10e6 + 100e6);
    //     assertEq(asset1.balanceOf(address(account)), 1e17 + 1e18);

    //     skip(86400); // seconds

    //     uint256 liabilities0 = lender0.borrowBalance(address(account));
    //     uint256 liabilities1 = lender1.borrowBalance(address(account));
    //     uint256 assets0 = asset0.balanceOf(address(account));
    //     uint256 assets1 = asset1.balanceOf(address(account));

    //     bytes memory data_two = abi.encode(
    //         0,
    //         0,
    //         0,
    //         0,
    //         assets0 - ((liabilities0 * 1.005e8) / 1e8),
    //         assets1 - ((liabilities1 * 1.005e8) / 1e8)
    //     );
    //     bool[4] memory allowances_two;
    //     allowances_two[0] = true;
    //     allowances_two[1] = true;
    //     account.modify(this, data_two, allowances_two);

    //     skip(86400);
    //     lender0.accrueInterest();
    //     lender1.accrueInterest();

    //     console.log("Lender accured interest");
    //     liquidator.liquidate(account);
    // }

    function _prepareKitties() private {
        address alice = makeAddr("alice");

        deal(address(asset0), address(lender0), 10000e6);
        lender0.deposit(10000e6, alice);

        deal(address(asset1), address(lender1), 3e18);
        lender1.deposit(3e18, alice);
    }
}