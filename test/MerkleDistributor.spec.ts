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
    let token1: TestERC20;
    let token2: TestERC20;
    let tree: BalanceTree;

    before(async () => {
        Distributor = (await ethers.getContractFactory("MerkleDistributor")) as MerkleDistributor__factory;
        signers = await ethers.getSigners();
        [alice, bob] = signers;

        let Token = await ethers.getContractFactory("TestERC20");
        token1 = (await Token.deploy("Token", "TKN", 0)) as TestERC20;
        token2 = (await Token.deploy("Token", "TKN", 0)) as TestERC20;
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
            await expect(distributor.claim(token1.address, 10, [])).to.be.revertedWith(
                "MerkleDistributor: Invalid proof."
            );
        });

        describe("two account tree", () => {
            beforeEach("deploy", async () => {
                tree = new BalanceTree([
                    { account: alice.address, token: token1.address, earnings: BigNumber.from(100) },
                    { account: bob.address, token: token1.address, earnings: BigNumber.from(101) },
                    { account: alice.address, token: token2.address, earnings: BigNumber.from(1) },
                    { account: bob.address, token: token2.address, earnings: BigNumber.from(2) },
                ]);
                distributor = (await Distributor.deploy(tree.getHexRoot())) as MerkleDistributor;
                await token1.setBalance(distributor.address, 201);
                await token2.setBalance(distributor.address, 3);
            });

            it("successful claim", async () => {
                const proof0 = tree.getProof(alice.address, token1.address, BigNumber.from(100));
                await expect(distributor.connect(alice).claim(token1.address, 100, proof0))
                    .to.emit(distributor, "Claimed")
                    .withArgs(alice.address, token1.address, 100);

                const proof1 = tree.getProof(bob.address, token1.address, BigNumber.from(101));
                await expect(distributor.connect(bob).claim(token1.address, 101, proof1))
                    .to.emit(distributor, "Claimed")
                    .withArgs(bob.address, token1.address, 101);

                const proof2 = tree.getProof(alice.address, token2.address, BigNumber.from(1));
                await expect(distributor.connect(alice).claim(token2.address, 1, proof2))
                    .to.emit(distributor, "Claimed")
                    .withArgs(alice.address, token2.address, 1);

                const proof3 = tree.getProof(bob.address, token2.address, BigNumber.from(2));
                await expect(distributor.connect(bob).claim(token2.address, 2, proof3))
                    .to.emit(distributor, "Claimed")
                    .withArgs(bob.address, token2.address, 2);
            });

            it("transfers the token", async () => {
                await token1.setBalance(alice.address, 0);
                const proof0 = tree.getProof(alice.address, token1.address, BigNumber.from(100));
                expect(await token1.balanceOf(alice.address)).to.eq(0);
                await distributor.claim(token1.address, 100, proof0);
                expect(await token1.balanceOf(alice.address)).to.eq(100);
            });

            it("must have enough to transfer", async () => {
                const proof0 = tree.getProof(alice.address, token1.address, BigNumber.from(100));
                await token1.setBalance(distributor.address, 99);
                await expect(distributor.connect(alice).claim(token1.address, 100, proof0)).to.be.revertedWith(
                    "ERC20: transfer amount exceeds balance"
                );
            });

            it("sets claimed", async () => {
                const proof0 = tree.getProof(alice.address, token1.address, BigNumber.from(100));
                expect(await distributor.getClaimed(alice.address, token1.address)).to.eq(0);
                expect(await distributor.getClaimed(bob.address, token1.address)).to.eq(0);
                await distributor.connect(alice).claim(token1.address, 100, proof0);
                expect(await distributor.getClaimed(alice.address, token1.address)).to.eq(100);
                expect(await distributor.getClaimed(bob.address, token1.address)).to.eq(0);
            });

            it("cannot allow two claims", async () => {
                const proof0 = tree.getProof(alice.address, token1.address, BigNumber.from(100));
                await distributor.connect(alice).claim(token1.address, 100, proof0);
                await expect(distributor.connect(alice).claim(token1.address, 100, proof0)).to.be.revertedWith(
                    "MerkleDistributor: Nothing to claim."
                );
            });

            it("cannot claim for address other than proof", async () => {
                const proof0 = tree.getProof(alice.address, token1.address, BigNumber.from(100));
                await expect(distributor.connect(bob).claim(token1.address, 100, proof0)).to.be.revertedWith(
                    "MerkleDistributor: Invalid proof."
                );
            });

            it("cannot claim more than proof", async () => {
                const proof0 = tree.getProof(alice.address, token1.address, BigNumber.from(100));
                await expect(distributor.connect(alice).claim(token1.address, 101, proof0)).to.be.revertedWith(
                    "MerkleDistributor: Invalid proof."
                );
            });

            it("cannot claim valid proof for wrong token", async () => {
                const proof0 = tree.getProof(alice.address, token1.address, BigNumber.from(100));
                await expect(distributor.connect(alice).claim(token2.address, 100, proof0)).to.be.revertedWith(
                    "MerkleDistributor: Invalid proof."
                );
            });
        });

        describe("realistic size tree", () => {
            const NUM_SAMPLES = 25;
            const elements: Balance[] = [];

            before(async () => {
                for (let i = 0; i < signers.length; i++) {
                    const node1 = {
                        account: signers[i].address,
                        token: token1.address,
                        earnings: BigNumber.from(i + 1),
                    };
                    const node2 = {
                        account: signers[i].address,
                        token: token2.address,
                        earnings: BigNumber.from(i + 2),
                    };
                    elements.push(node1);
                    elements.push(node2);
                }
                tree = new BalanceTree(elements);
            });

            beforeEach("deploy", async () => {
                distributor = (await Distributor.deploy(tree.getHexRoot())) as MerkleDistributor;
                await token1.setBalance(distributor.address, signers.length * NUM_SAMPLES);
                await token2.setBalance(distributor.address, signers.length * NUM_SAMPLES);
            });

            it("proof verification works", () => {
                const root = Buffer.from(tree.getHexRoot().slice(2), "hex");
                for (let j = 0; j < NUM_SAMPLES; j += 1) {
                    const i = Math.floor(Math.random() * signers.length);
                    // Token 1
                    const proof1 = tree
                        .getProof(signers[i].address, token1.address, BigNumber.from(i + 1))
                        .map((el) => Buffer.from(el.slice(2), "hex"));
                    const validProof1 = BalanceTree.verifyProof(
                        signers[i].address,
                        token1.address,
                        BigNumber.from(i + 1),
                        proof1,
                        root
                    );
                    expect(validProof1).to.be.true;
                    // Token 2
                    const proof2 = tree
                        .getProof(signers[i].address, token2.address, BigNumber.from(i + 2))
                        .map((el) => Buffer.from(el.slice(2), "hex"));
                    const validProof2 = BalanceTree.verifyProof(
                        signers[i].address,
                        token2.address,
                        BigNumber.from(i + 2),
                        proof2,
                        root
                    );
                    expect(validProof2).to.be.true;
                }
            });

            it("no double claims in random distribution", async () => {
                for (let j = 0; j < NUM_SAMPLES; j += 1) {
                    const i = Math.floor(Math.random() * signers.length);
                    // Token 1
                    const proof1 = tree.getProof(signers[i].address, token1.address, BigNumber.from(i + 1));
                    await expect(distributor.connect(signers[i]).claim(token1.address, i + 1, proof1))
                        .to.emit(distributor, "Claimed")
                        .withArgs(signers[i].address, token1.address, i + 1);
                    await expect(
                        distributor.connect(signers[i]).claim(token1.address, i + 1, proof1)
                    ).to.be.revertedWith("MerkleDistributor: Nothing to claim.");
                    // Token 2
                    const proof2 = tree.getProof(signers[i].address, token2.address, BigNumber.from(i + 2));
                    await expect(distributor.connect(signers[i]).claim(token2.address, i + 2, proof2))
                        .to.emit(distributor, "Claimed")
                        .withArgs(signers[i].address, token2.address, i + 2);
                    await expect(
                        distributor.connect(signers[i]).claim(token2.address, i + 2, proof2)
                    ).to.be.revertedWith("MerkleDistributor: Nothing to claim.");
                }
            });
        });
    });

    describe("parseBalanceMap", () => {
        let distributor: MerkleDistributor;
        let claims1: MerkleClaim;
        let claims2: MerkleClaim;

        beforeEach("deploy", async () => {
            const { tokens, merkleRoot } = parseBalanceMap([
                { token: token1.address, account: alice.address, earnings: BigNumber.from(200) },
                { token: token1.address, account: bob.address, earnings: BigNumber.from(300) },
                { token: token1.address, account: signers[2].address, earnings: BigNumber.from(250) },
                { token: token2.address, account: alice.address, earnings: BigNumber.from(75) },
                { token: token2.address, account: bob.address, earnings: BigNumber.from(25) },
                { token: token2.address, account: signers[2].address, earnings: BigNumber.from(50) },
            ]);

            claims1 = tokens[token1.address].claims;
            expect(tokens[token1.address].tokenTotal).to.eq("0x02ee"); // 750;
            claims2 = tokens[token2.address].claims;
            expect(tokens[token2.address].tokenTotal).to.eq("0x96"); // 150;
            distributor = (await Distributor.deploy(merkleRoot)) as MerkleDistributor;
            await token1.setBalance(distributor.address, tokens[token1.address].tokenTotal);
            await token2.setBalance(distributor.address, tokens[token2.address].tokenTotal);
        });

        it("check the proofs is as expected", () => {
            expect(claims1).to.deep.eq({
                [alice.address]: {
                    earnings: "0xc8",
                    proof: [
                        "0x4a1481a92283c79662b05e0a08d58801925d3edb9a81f3327f27ae56ad8939a7",
                        "0x3642123b65aac68d15e109d5b4777c286601df51006236ffcd81814a8cfe2d00",
                        "0x37a4adc4622fc7d91f98e3926996b9b5c2fd85cbd734635b78a1881b36d4430e",
                    ],
                },
                [bob.address]: {
                    earnings: "0x012c",
                    proof: [
                        "0xcfddda2b849eac2c05f610e70a9b91257ad20c1b380edaa397d8c8de699f1bd2",
                        "0xafc981e0239452424c1dc05d02cf866525c5cc9fb56fbc7abb2d446788cd1fbb",
                    ],
                },
                [signers[2].address]: {
                    earnings: "0xfa",
                    proof: [
                        "0x92610abc99e1f7af6273c45c66865568a826c0e0008f62ce9ad527e8d433bd33",
                        "0xf432cf491a7cd2aa81962515023c122278770d95eea4015fa466ccf7ed670d90",
                        "0x37a4adc4622fc7d91f98e3926996b9b5c2fd85cbd734635b78a1881b36d4430e",
                    ],
                },
            });

            expect(claims2).to.deep.eq({
                [alice.address]: {
                    earnings: "0x4b",
                    proof: [
                        "0x4fca2559b2e764844a58810d14308df836a11f8ab0b62f4596720dc7a31e89f3",
                        "0xf432cf491a7cd2aa81962515023c122278770d95eea4015fa466ccf7ed670d90",
                        "0x37a4adc4622fc7d91f98e3926996b9b5c2fd85cbd734635b78a1881b36d4430e",
                    ],
                },
                [bob.address]: {
                    earnings: "0x19",
                    proof: [
                        "0xcc8f65115eededa848f7744ffa2715dd7f12f011c4e17fa19d19d3e8a2bb2a1c",
                        "0xafc981e0239452424c1dc05d02cf866525c5cc9fb56fbc7abb2d446788cd1fbb",
                    ],
                },
                [signers[2].address]: {
                    earnings: "0x32",
                    proof: [
                        "0x3826d7d3bf5bf7dc95efc4db4c924a6651b5d20c488af437388bb922b3cd650b",
                        "0x3642123b65aac68d15e109d5b4777c286601df51006236ffcd81814a8cfe2d00",
                        "0x37a4adc4622fc7d91f98e3926996b9b5c2fd85cbd734635b78a1881b36d4430e",
                    ],
                },
            });
        });

        it("all claims work exactly once", async () => {
            // Claim token1
            expect(await token1.balanceOf(distributor.address)).to.eq(750);
            for (const [key, value] of Object.entries(claims1)) {
                const signer = signers.find((signer) => signer.address === key)!;
                await expect(distributor.connect(signer).claim(token1.address, value.earnings, value.proof))
                    .to.emit(distributor, "Claimed")
                    .withArgs(key, token1.address, value.earnings);
                await expect(
                    distributor.connect(signer).claim(token1.address, value.earnings, value.proof)
                ).to.be.revertedWith("MerkleDistributor: Nothing to claim.");
            }
            expect(await token1.balanceOf(distributor.address)).to.eq(0);

            // Claim token2
            expect(await token2.balanceOf(distributor.address)).to.eq(150);
            for (const [key, value] of Object.entries(claims2)) {
                const signer = signers.find((signer) => signer.address === key)!;
                await expect(distributor.connect(signer).claim(token2.address, value.earnings, value.proof))
                    .to.emit(distributor, "Claimed")
                    .withArgs(key, token2.address, value.earnings);
                await expect(
                    distributor.connect(signer).claim(token2.address, value.earnings, value.proof)
                ).to.be.revertedWith("MerkleDistributor: Nothing to claim.");
            }
            expect(await token2.balanceOf(distributor.address)).to.eq(0);
        });
    });
});
