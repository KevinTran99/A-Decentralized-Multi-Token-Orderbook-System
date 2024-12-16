// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title ERC20Mock
 * @dev Test ERC20 token with public minting for DEX testing purposes
 * WARNING: This contract is for testing only and should not be used in production
 */
contract ERC20Mock is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimalsValue) ERC20(name, symbol) {
        _decimals = decimalsValue;
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }

    /**
     * @dev Returns the number of decimals used for token amounts
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Allows anyone to mint tokens for testing purposes
     * @param amount The amount of tokens to mint
     */
    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}