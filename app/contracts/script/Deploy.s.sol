// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Script.sol";

import {Liquidator} from "../src/Liquidator.sol";

bytes32 constant TAG = bytes32(uint256(0xA10EBE1A));

contract DeployScript is Script {
    function run() external {
        vm.createSelectFork(vm.rpcUrl("optimism"));
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        new Liquidator{salt: TAG}();
        vm.stopBroadcast();

        vm.createSelectFork(vm.rpcUrl("arbitrum"));
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        new Liquidator{salt: TAG}();
        vm.stopBroadcast();
    }
}
