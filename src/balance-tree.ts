import MerkleTree from "./merkle-tree";
import { BigNumber, utils } from "ethers";

export default class BalanceTree {
    private readonly tree: MerkleTree;
    constructor(balances: { account: string; token: string; amount: BigNumber }[]) {
        this.tree = new MerkleTree(
            balances.map(({ account, amount, token }) => {
                return BalanceTree.toNode(account, token, amount);
            })
        );
    }

    public static verifyProof(
        account: string,
        token: string,
        amount: BigNumber,
        proof: Buffer[],
        root: Buffer
    ): boolean {
        let pair = BalanceTree.toNode(account, token, amount);
        for (const item of proof) {
            pair = MerkleTree.combinedHash(pair, item);
        }

        return pair.equals(root);
    }

    // keccak256(abi.encode(index, account, amount))
    public static toNode(account: string, token: string, amount: BigNumber): Buffer {
        return Buffer.from(
            utils.solidityKeccak256(["address", "address", "uint256"], [account, token, amount]).substr(2),
            "hex"
        );
    }

    public getHexRoot(): string {
        return this.tree.getHexRoot();
    }

    // returns the hex bytes32 values of the proof
    public getProof(account: string, token: string, amount: BigNumber): string[] {
        return this.tree.getHexProof(BalanceTree.toNode(account, token, amount));
    }
}
