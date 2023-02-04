#!/bin/bash
source .env
forge script script/Deploy.s.sol:DeployScript --fork-url $RPC_URL_OPTIMISM -vv --broadcast --verify
