#!/bin/bash
source .env
forge script contracts/script/Deploy.s.sol:DeployScript --fork-url $RPC_URL_OPTIMISM --broadcast -vv
