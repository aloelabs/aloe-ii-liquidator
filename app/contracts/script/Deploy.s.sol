// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Script.sol";

import {Liquidator} from "../src/Liquidator.sol";

contract DeployScript is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        new Liquidator();

        vm.stopBroadcast();
    }
}
