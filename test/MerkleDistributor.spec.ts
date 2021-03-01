import { expect } from "chai";
import { ethers } from "hardhat";
import { MerkleDistributor, MerkleDistributor__factory, TestERC20 } from "../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import BalanceTree from "../src/balance-tree";
import { BigNumber } from "ethers";
import { Balance, MerkleClaim, parseBalanceMap } from "../src/parse-balance-map";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("MerkleDistributor", () => {
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let Distributor: MerkleDistributor__factory;
    let distributor: MerkleDistributor;
    let signers: SignerWithAddress[];
    let token: TestERC20;
    let tree: BalanceTree;

    before(async () => {
        Distributor = (await ethers.getContractFactory("MerkleDistributor")) as MerkleDistributor__factory;
        signers = await ethers.getSigners();
        [alice, bob] = signers;

        let Token = await ethers.getContractFactory("TestERC20");
        token = (await Token.deploy("Token", "TKN", 0)) as TestERC20;
    });

    describe("merkleRoot", () => {
        it("returns the zero merkle root", async () => {
            const distributor = (await Distributor.deploy(ZERO_BYTES32)) as MerkleDistributor;
            expect(await distributor.merkleRoot()).to.eq(ZERO_BYTES32);
        });
    });

    describe("claim", () => {
        it("fails for empty proof", async () => {
            const distributor = (await Distributor.deploy(ZERO_BYTES32)) as MerkleDistributor;
            await expect(distributor.claim(token.address, 10, [])).to.be.revertedWith(
                "MerkleDistributor: Invalid proof."
            );
        });

        describe("two account tree", () => {
            beforeEach("deploy", async () => {
                tree = new BalanceTree([
                    { account: alice.address, token: token.address, earnings: BigNumber.from(100) },
                    { account: bob.address, token: token.address, earnings: BigNumber.from(101) },
                ]);
                distributor = (await Distributor.deploy(tree.getHexRoot())) as MerkleDistributor;
                await token.setBalance(distributor.address, 201);
            });

            it("successful claim", async () => {
                const proof0 = tree.getProof(alice.address, token.address, BigNumber.from(100));
                await expect(distributor.connect(alice).claim(token.address, 100, proof0))
                    .to.emit(distributor, "Claimed")
                    .withArgs(alice.address, token.address, 100);

                const proof1 = tree.getProof(bob.address, token.address, BigNumber.from(101));
                await expect(distributor.connect(bob).claim(token.address, 101, proof1))
                    .to.emit(distributor, "Claimed")
                    .withArgs(bob.address, token.address, 101);
            });

            it("transfers the token", async () => {
                await token.setBalance(alice.address, 0);
                const proof0 = tree.getProof(alice.address, token.address, BigNumber.from(100));
                expect(await token.balanceOf(alice.address)).to.eq(0);
                await distributor.claim(token.address, 100, proof0);
                expect(await token.balanceOf(alice.address)).to.eq(100);
            });

            it("must have enough to transfer", async () => {
                const proof0 = tree.getProof(alice.address, token.address, BigNumber.from(100));
                await token.setBalance(distributor.address, 99);
                await expect(distributor.connect(alice).claim(token.address, 100, proof0)).to.be.revertedWith(
                    "ERC20: transfer amount exceeds balance"
                );
            });

            it("sets claimed", async () => {
                const proof0 = tree.getProof(alice.address, token.address, BigNumber.from(100));
                expect(await distributor.getClaimed(alice.address, token.address)).to.eq(0);
                expect(await distributor.getClaimed(bob.address, token.address)).to.eq(0);
                await distributor.connect(alice).claim(token.address, 100, proof0);
                expect(await distributor.getClaimed(alice.address, token.address)).to.eq(100);
                expect(await distributor.getClaimed(bob.address, token.address)).to.eq(0);
            });

            it("cannot allow two claims", async () => {
                const proof0 = tree.getProof(alice.address, token.address, BigNumber.from(100));
                await distributor.connect(alice).claim(token.address, 100, proof0);
                await expect(distributor.connect(alice).claim(token.address, 100, proof0)).to.be.revertedWith(
                    "MerkleDistributor: Nothing to claim."
                );
            });

            it("cannot claim for address other than proof", async () => {
                const proof0 = tree.getProof(alice.address, token.address, BigNumber.from(100));
                await expect(distributor.connect(bob).claim(token.address, 100, proof0)).to.be.revertedWith(
                    "MerkleDistributor: Invalid proof."
                );
            });

            it("cannot claim more than proof", async () => {
                const proof0 = tree.getProof(alice.address, token.address, BigNumber.from(100));
                await expect(distributor.connect(alice).claim(token.address, 101, proof0)).to.be.revertedWith(
                    "MerkleDistributor: Invalid proof."
                );
            });
        });

        describe("realistic size tree", () => {
            const NUM_SAMPLES = 25;
            const elements: Balance[] = [];

            before(async () => {
                for (let i = 0; i < signers.length; i++) {
                    const node = { account: signers[i].address, token: token.address, earnings: BigNumber.from(i + 1) };
                    elements.push(node);
                }
                tree = new BalanceTree(elements);
            });

            beforeEach("deploy", async () => {
                distributor = (await Distributor.deploy(tree.getHexRoot())) as MerkleDistributor;
                await token.setBalance(distributor.address, signers.length * NUM_SAMPLES);
            });

            it("proof verification works", () => {
                const root = Buffer.from(tree.getHexRoot().slice(2), "hex");
                for (let j = 0; j < NUM_SAMPLES; j += 1) {
                    const i = Math.floor(Math.random() * signers.length);
                    const proof = tree
                        .getProof(signers[i].address, token.address, BigNumber.from(i + 1))
                        .map((el) => Buffer.from(el.slice(2), "hex"));
                    const validProof = BalanceTree.verifyProof(
                        signers[i].address,
                        token.address,
                        BigNumber.from(i + 1),
                        proof,
                        root
                    );
                    expect(validProof).to.be.true;
                }
            });

            it("no double claims in random distribution", async () => {
                for (let j = 0; j < NUM_SAMPLES; j += 1) {
                    const i = Math.floor(Math.random() * signers.length);
                    const proof = tree.getProof(signers[i].address, token.address, BigNumber.from(i + 1));
                    await expect(distributor.connect(signers[i]).claim(token.address, i + 1, proof))
                        .to.emit(distributor, "Claimed")
                        .withArgs(signers[i].address, token.address, i + 1);
                    await expect(distributor.connect(signers[i]).claim(token.address, i + 1, proof)).to.be.revertedWith(
                        "MerkleDistributor: Nothing to claim."
                    );
                }
            });
        });
    });

    describe("parseBalanceMap", () => {
        let distributor: MerkleDistributor;
        let claims: MerkleClaim;

        beforeEach("deploy", async () => {
            const { tokens: merkleToken, merkleRoot } = parseBalanceMap([
                { token: token.address, account: alice.address, earnings: BigNumber.from(200) },
                { token: token.address, account: bob.address, earnings: BigNumber.from(300) },
                { token: token.address, account: signers[2].address, earnings: BigNumber.from(250) },
            ]);

            claims = merkleToken[token.address].claims;
            expect(merkleToken[token.address].tokenTotal).to.eq("0x02ee"); // 750;
            distributor = (await Distributor.deploy(merkleRoot)) as MerkleDistributor;
            await token.setBalance(distributor.address, merkleToken[token.address].tokenTotal);
        });

        it("check the proofs is as expected", () => {
            expect(claims).to.deep.eq({
                [alice.address]: {
                    earnings: "0xc8",
                    proof: [
                        "0x4fca2559b2e764844a58810d14308df836a11f8ab0b62f4596720dc7a31e89f3",
                        "0xcc8f65115eededa848f7744ffa2715dd7f12f011c4e17fa19d19d3e8a2bb2a1c",
                    ],
                },
                [bob.address]: {
                    earnings: "0x012c",
                    proof: ["0x884ebfef3ad75732d0a52fe246d7aa3124fedbfc26a01ab9f35b4e0cb4fb2095"],
                },
                [signers[2].address]: {
                    earnings: "0xfa",
                    proof: [
                        "0x3826d7d3bf5bf7dc95efc4db4c924a6651b5d20c488af437388bb922b3cd650b",
                        "0xcc8f65115eededa848f7744ffa2715dd7f12f011c4e17fa19d19d3e8a2bb2a1c",
                    ],
                },
            });
        });

        it("all claims work exactly once", async () => {
            expect(await token.balanceOf(distributor.address)).to.eq(750);
            for (const [key, value] of Object.entries(claims)) {
                const signer = signers.find((signer) => signer.address === key)!;
                await expect(distributor.connect(signer).claim(token.address, value.earnings, value.proof))
                    .to.emit(distributor, "Claimed")
                    .withArgs(key, token.address, value.earnings);

                await expect(
                    distributor.connect(signer).claim(token.address, value.earnings, value.proof)
                ).to.be.revertedWith("MerkleDistributor: Nothing to claim.");
            }
            expect(await token.balanceOf(distributor.address)).to.eq(0);
        });
    });
});
