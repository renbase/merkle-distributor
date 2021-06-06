import { BigNumber, utils } from "ethers";
import BalanceTree from "./balance-tree";

const { isAddress, getAddress } = utils;

// This is the blob that gets distributed and pinned to IPFS.
// It is completely sufficient for recreating the entire merkle tree.
// Anyone can verify that all air drops are included in the tree,
// and the tree has no additional distributions.
interface MerkleDistributorInfo {
    merkleRoot: string;
    tokens: MerkleToken;
}

interface MerkleToken {
    [token: string]: {
        tokenTotal: string;
        claims: MerkleClaim;
    };
}

export interface MerkleClaim {
    [account: string]: {
        earnings: string;
        proof: string[];
    };
}

export type Balance = { token: string; account: string; earnings: BigNumber };

export function parseBalanceMap(balances: Balance[]): MerkleDistributorInfo {
    // Use checksummed token and account
    const parsedBalances = balances.map(({ token, account, earnings }) => {
        if (!isAddress(token)) {
            throw new Error(`Found invalid token address: ${token}`);
        }
        const parsedToken = getAddress(token);

        if (!isAddress(account)) {
            throw new Error(`Found invalid account address: ${account}`);
        }
        const parsedAccount = getAddress(account);

        const parsedEarnings = BigNumber.from(earnings);
        if (parsedEarnings.lte(0)) throw new Error(`Invalid amount for account: ${account} for token: ${token}`);

        return { token: parsedToken, account: parsedAccount, earnings: parsedEarnings };
    });

    // Construct a tree from parsedSorted
    const tree = new BalanceTree(parsedBalances);

    // Generate claims for each token
    const tokens = parsedBalances.reduce<MerkleToken>((memo, { token, account, earnings }) => {
        const claim: MerkleClaim = {
            [account]: {
                earnings: earnings.toHexString(),
                proof: tree.getProof(account, token, earnings),
            },
        };

        if (!memo[token]) {
            memo[token] = {
                claims: claim,
                tokenTotal: earnings.toHexString(),
            };
            return memo;
        }

        if (memo[token].claims[account]) {
            throw new Error(`Duplicate account: ${account} for token: ${token}`);
        }

        memo[token].claims = Object.assign({}, memo[token].claims, claim);
        memo[token].tokenTotal = BigNumber.from(memo[token].tokenTotal).add(earnings).toHexString();

        return memo;
    }, {});

    return {
        merkleRoot: tree.getHexRoot(),
        tokens,
    };
}
