// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ConfidentialEscrow} from "../ConfidentialEscrow.sol";

// Deploy the escrow to Base Sepolia.
//   forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_SEPOLIA_RPC --broadcast
//
// The discoveryWorker MUST match the worker address used in the GenLayer
// tribunal constructor, and the relayer is whoever delivers the verdict.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("ESCROW_DEPLOYER_KEY");
        address relayer = vm.envAddress("TRIBUNAL_RELAYER");
        address worker = vm.envAddress("WORKER_ADDRESS");

        vm.startBroadcast(pk);
        ConfidentialEscrow escrow = new ConfidentialEscrow(relayer, worker);
        vm.stopBroadcast();

        console.log("ConfidentialEscrow deployed at:", address(escrow));
        console.log("Set ESCROW_ADDRESS in .env to the address above.");
    }
}
