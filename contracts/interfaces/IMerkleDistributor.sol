// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.5.0;

// Allows anyone to claim a token if they exist in a merkle root.
interface IMerkleDistributor {
    // Returns the merkle root of the merkle tree containing account balances available to claim.
    function merkleRoot() external view returns (bytes32);

    // Claim the given amount of the token to the given address. Reverts if the inputs are invalid.
    function claim(
        address _token,
        uint256 _cumulativeAmount,
        bytes32[] calldata _merkleProof
    ) external;

    function getClaimed(address _account, address _token) external view returns (uint256);

    // Updates the merkle root.
    function updateMerkleRoot(bytes32 _merkleRoot) external;

    // This event is triggered whenever a call to #claim succeeds.
    event Claimed(address _account, address _token, uint256 _amount);
}
