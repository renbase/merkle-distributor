// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.7.3;

import "@openzeppelin/contracts/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IMerkleDistributor.sol";

contract MerkleDistributor is IMerkleDistributor {
    using SafeMath for uint256;

    bytes32 public override merkleRoot;

    // Mapping of addresses to the cumulative total earned of each token.
    mapping(address => mapping(address => uint256)) claimed;

    constructor(bytes32 _merkleRoot) {
        merkleRoot = _merkleRoot;
    }

    function claim(
        address _token,
        uint256 _amount,
        bytes32[] calldata _merkleProof
    ) external override {
        // Verify the merkle proof.
        bytes32 node = keccak256(abi.encodePacked(msg.sender, _token, _amount));
        require(MerkleProof.verify(_merkleProof, merkleRoot, node), "MerkleDistributor: Invalid proof.");

        // Calculate the amount to be claimed.
        uint256 claimable = _amount.sub(claimed[msg.sender][_token], "MerkleDistributor: Excessive claim.");
        require(claimable > 0, "MerkleDistributor: Nothing to claim.");

        // Mark it claimed and send the token.
        claimed[msg.sender][_token] = claimed[msg.sender][_token].add(claimable);
        require(IERC20(_token).transfer(msg.sender, claimable), "MerkleDistributor: Transfer failed.");

        emit Claimed(msg.sender, _token, _amount);
    }

    function getClaimed(address _account, address _token) external view override returns (uint256) {
        return claimed[_account][_token];
    }

    function updateMerkleRoot(bytes32 _merkleRoot) external override {
        merkleRoot = _merkleRoot;
    }
}
