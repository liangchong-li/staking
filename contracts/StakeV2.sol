// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "./Stake.sol";

contract StakeV2 is Stake {
    function helloUpgrades() external pure returns (string memory) {
        return "Hello, Upgrades";
    }
}
