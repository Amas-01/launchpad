import { Keypair } from "@stellar/stellar-sdk";
import {
  buildProofSet,
  buildTree,
  encodeI128BE,
  getProof,
  hashPair,
  leafHash,
  parseAllocationsCsv,
  parseDecimalAmount,
  toHex,
  fromHex,
  verifyProof,
  type Allocation,
} from "@/lib/merkle";

const addresses = (n: number): string[] =>
  Array.from({ length: n }, () => Keypair.random().publicKey());

const allocate = (addrs: string[]): Allocation[] =>
  addrs.map((address, i) => ({ address, amount: BigInt((i + 1) * 100) }));

describe("encodeI128BE", () => {
  it("encodes positive values as 16 big-endian bytes", () => {
    expect(toHex(encodeI128BE(0n))).toBe("0".repeat(32));
    expect(toHex(encodeI128BE(1n))).toBe("0".repeat(31) + "1");
    expect(toHex(encodeI128BE(255n))).toBe("0".repeat(30) + "ff");
    expect(toHex(encodeI128BE(1_000_000_000n))).toBe(
      "0000000000000000000000003b9aca00",
    );
  });

  it("encodes negative values in two's complement", () => {
    expect(toHex(encodeI128BE(-1n))).toBe("f".repeat(32));
  });

  it("rejects values outside the i128 range", () => {
    expect(() => encodeI128BE(2n ** 127n)).toThrow(/i128/);
    expect(() => encodeI128BE(-(2n ** 127n) - 1n)).toThrow(/i128/);
  });
});

describe("hex helpers", () => {
  it("round-trips", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 254, 255]);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
  });

  it("accepts a 0x prefix and rejects malformed input", () => {
    expect(fromHex("0xff")).toEqual(new Uint8Array([255]));
    expect(() => fromHex("abc")).toThrow(/hex/i);
    expect(() => fromHex("zz")).toThrow(/hex/i);
  });
});

describe("leafHash", () => {
  /**
   * Pins the leaf encoding against the same vector
   * `contracts/airdrop/src/lib.rs::test_leaf_hash_matches_cross_language_vector`
   * asserts on. If this fails, the browser and the contract no longer agree
   * on what a leaf is and every proof built here would be rejected on chain.
   */
  it("matches the contract's cross-language test vector", () => {
    const hash = leafHash(
      "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
      1_000_000_000n,
    );
    expect(toHex(hash)).toBe(
      "08e7126dd5378bd1e009c056ce89f2711888715afde993576dcc0ee0e4671147",
    );
  });

  it("is sensitive to both the address and the amount", () => {
    const [a, b] = addresses(2);
    expect(toHex(leafHash(a, 100n))).not.toBe(toHex(leafHash(b, 100n)));
    expect(toHex(leafHash(a, 100n))).not.toBe(toHex(leafHash(a, 101n)));
  });
});

describe("hashPair", () => {
  it("is order-independent, because siblings are sorted before hashing", () => {
    const a = leafHash(Keypair.random().publicKey(), 1n);
    const b = leafHash(Keypair.random().publicKey(), 2n);
    expect(toHex(hashPair(a, b))).toBe(toHex(hashPair(b, a)));
  });

  it("keeps node hashes disjoint from leaf hashes", () => {
    // Domain separation: an internal node must never collide with a leaf,
    // or it could be replayed as an (address, amount) allocation.
    const addr = Keypair.random().publicKey();
    const leaf = leafHash(addr, 100n);
    const node = hashPair(leaf, leaf);
    expect(toHex(node)).not.toBe(toHex(leaf));
  });
});

describe("buildTree / getProof / verifyProof", () => {
  it("treats a single allocation's leaf as the root, with an empty proof", () => {
    const [addr] = addresses(1);
    const tree = buildTree([{ address: addr, amount: 500n }]);

    expect(tree.root).toBe(toHex(leafHash(addr, 500n)));
    expect(getProof(tree, 0)).toEqual([]);
    expect(verifyProof(addr, 500n, [], tree.root)).toBe(true);
  });

  it.each([2, 3, 4, 5, 7, 8, 9, 16, 33])(
    "produces a verifying proof for every allocation in a %i-leaf tree",
    (n) => {
      const allocations = allocate(addresses(n));
      const tree = buildTree(allocations);

      allocations.forEach((alloc, i) => {
        const proof = getProof(tree, i);
        expect(verifyProof(alloc.address, alloc.amount, proof, tree.root)).toBe(
          true,
        );
      });
    },
  );

  it("rejects a proof presented with the wrong amount", () => {
    const allocations = allocate(addresses(8));
    const tree = buildTree(allocations);
    const proof = getProof(tree, 3);

    expect(
      verifyProof(allocations[3].address, allocations[3].amount + 1n, proof, tree.root),
    ).toBe(false);
  });

  it("rejects one recipient's proof used by another", () => {
    const allocations = allocate(addresses(8));
    const tree = buildTree(allocations);
    const proof = getProof(tree, 3);

    expect(
      verifyProof(allocations[5].address, allocations[3].amount, proof, tree.root),
    ).toBe(false);
  });

  it("rejects an address that is not in the tree", () => {
    const allocations = allocate(addresses(4));
    const tree = buildTree(allocations);
    const outsider = Keypair.random().publicKey();

    expect(verifyProof(outsider, 100n, getProof(tree, 0), tree.root)).toBe(
      false,
    );
  });

  it("rejects non-positive amounts and over-long proofs", () => {
    const allocations = allocate(addresses(4));
    const tree = buildTree(allocations);

    expect(verifyProof(allocations[0].address, 0n, [], tree.root)).toBe(false);
    expect(
      verifyProof(
        allocations[0].address,
        allocations[0].amount,
        Array.from({ length: 33 }, () => "00".repeat(32)),
        tree.root,
      ),
    ).toBe(false);
  });

  it("tolerates a 0x-prefixed or upper-case root", () => {
    const allocations = allocate(addresses(4));
    const tree = buildTree(allocations);
    const proof = getProof(tree, 1);

    expect(
      verifyProof(allocations[1].address, allocations[1].amount, proof, `0x${tree.root.toUpperCase()}`),
    ).toBe(true);
  });

  it("changes the root when any allocation changes", () => {
    const addrs = addresses(6);
    const rootA = buildTree(allocate(addrs)).root;
    const bumped = allocate(addrs);
    bumped[4].amount += 1n;

    expect(buildTree(bumped).root).not.toBe(rootA);
  });

  it("refuses to build from an empty list", () => {
    expect(() => buildTree([])).toThrow(/empty/i);
  });

  it("rejects an out-of-range proof index", () => {
    const tree = buildTree(allocate(addresses(3)));
    expect(() => getProof(tree, 3)).toThrow(/out of range/i);
    expect(() => getProof(tree, -1)).toThrow(/out of range/i);
  });
});

describe("buildProofSet", () => {
  it("exports a verifying proof and the correct total for every entry", () => {
    const allocations = allocate(addresses(10));
    const tree = buildTree(allocations);
    const set = buildProofSet(tree);

    expect(set.root).toBe(tree.root);
    expect(set.count).toBe(10);
    // 100 + 200 + … + 1000
    expect(set.total).toBe("5500");

    set.entries.forEach((entry, i) => {
      expect(entry.address).toBe(allocations[i].address);
      expect(entry.amount).toBe(allocations[i].amount.toString());
      expect(verifyProof(entry.address, BigInt(entry.amount), entry.proof, set.root)).toBe(true);
    });
  });

  it("survives a JSON round-trip, which is how recipients receive it", () => {
    const tree = buildTree(allocate(addresses(5)));
    const set = JSON.parse(JSON.stringify(buildProofSet(tree)));

    for (const entry of set.entries) {
      expect(verifyProof(entry.address, BigInt(entry.amount), entry.proof, set.root)).toBe(true);
    }
  });
});

describe("parseDecimalAmount", () => {
  it("scales to base units without losing precision", () => {
    expect(parseDecimalAmount("1", 7)).toBe(10_000_000n);
    expect(parseDecimalAmount("0.0000001", 7)).toBe(1n);
    expect(parseDecimalAmount("123.45", 7)).toBe(1_234_500_000n);
    // Past 2^53, where a Number-based implementation would drift.
    expect(parseDecimalAmount("90071992547409.9100000", 7)).toBe(
      900_719_925_474_099_100_000n,
    );
  });

  it("rejects malformed and over-precise amounts", () => {
    expect(() => parseDecimalAmount("abc", 7)).toThrow();
    expect(() => parseDecimalAmount("-5", 7)).toThrow();
    expect(() => parseDecimalAmount("1.23456789", 7)).toThrow(/decimal places/);
  });
});

describe("parseAllocationsCsv", () => {
  it("parses a plain address,amount list", () => {
    const [a, b] = addresses(2);
    const result = parseAllocationsCsv(`${a},1\n${b},2.5`, 7);

    expect(result.errors).toEqual([]);
    expect(result.allocations).toEqual([
      { address: a, amount: 10_000_000n },
      { address: b, amount: 25_000_000n },
    ]);
    expect(result.total).toBe(35_000_000n);
  });

  it("skips a header row, blank lines and comments", () => {
    const [a] = addresses(1);
    const result = parseAllocationsCsv(
      `address,amount\n\n# a comment\n${a},1\n`,
      7,
    );

    expect(result.errors).toEqual([]);
    expect(result.allocations).toHaveLength(1);
  });

  it("accepts semicolon separators and contract addresses", () => {
    const contractId = "CCC5R5VXLIDBIPXMIK33PPJKS5HTU2WZAWFGZY77MM57XFYHN7IMPQQV";
    const result = parseAllocationsCsv(`${contractId};3`, 7);

    expect(result.errors).toEqual([]);
    expect(result.allocations[0].address).toBe(contractId);
  });

  it("reports a bad address with its line number instead of dropping it", () => {
    const [a] = addresses(1);
    const result = parseAllocationsCsv(`${a},1\nGNOTVALID,2`, 7);

    expect(result.allocations).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Line 2/);
    expect(result.errors[0]).toMatch(/not a valid Stellar address/);
  });

  it("rejects a duplicated address rather than double-allocating it", () => {
    const [a] = addresses(1);
    const result = parseAllocationsCsv(`${a},1\n${a},2`, 7);

    expect(result.allocations).toHaveLength(1);
    expect(result.errors[0]).toMatch(/already allocated on line 1/);
  });

  it("rejects zero and malformed amounts", () => {
    const [a, b, c] = addresses(3);
    const result = parseAllocationsCsv(`${a},0\n${b},abc\n${c}`, 7);

    expect(result.allocations).toHaveLength(0);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[2]).toMatch(/expected "address,amount"/);
  });

  it("normalises lower-case addresses so they hash canonically", () => {
    const [a] = addresses(1);
    const result = parseAllocationsCsv(`${a.toLowerCase()},1`, 7);

    expect(result.errors).toEqual([]);
    expect(result.allocations[0].address).toBe(a);
  });
});
