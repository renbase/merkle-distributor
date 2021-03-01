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
        tokenTotal: BigNumber;
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
    // Sort data by token, then by account
    const sorted = balances.sort((a, b) => a.token.localeCompare(b.token) || a.account.localeCompare(b.account));

    // Use checksummed token and account
    const parsedSorted = sorted.map(({ token, account, earnings }) => {
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
    const tree = new BalanceTree(parsedSorted);

    // Generate claims for each token
    const tokens = parsedSorted.reduce<MerkleToken>((memo, { token, account, earnings }) => {
        const claim: MerkleClaim = {
            [account]: {
                earnings: earnings.toHexString(),
                proof: tree.getProof(account, token, earnings),
            },
        };

        if (!memo[token]) {
            memo[token] = {
                claims: claim,
                tokenTotal: earnings,
            };
            return memo;
        }

        if (memo[token].claims[account]) {
            throw new Error(`Duplicate account: ${account} for token: ${token}`);
        }

        memo[token].claims = Object.assign({}, memo[token].claims, claim);
        memo[token].tokenTotal = memo[token].tokenTotal.add(earnings);

        return memo;
    }, {});

    return {
        merkleRoot: tree.getHexRoot(),
        tokens,
    };
}
