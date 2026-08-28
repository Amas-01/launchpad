/**
 * Merkle tree construction for the airdrop contract.
 *
 * This is the off-chain half of `contracts/airdrop`. The admin builds a tree
 * over the whole allocation list in the browser, publishes only the 32-byte
 * root on chain, and hands each recipient a proof. The contract re-derives the
 * leaf and walks the proof back to the root, so both sides must agree on the
 * hashing byte-for-byte:
 *
 * ```text
 * leaf(addr, amount) = keccak256(0x00 || ascii(strkey(addr)) || be_i128(amount))
 * node(a, b)         = keccak256(0x01 || min(a, b) || max(a, b))
 * ```
 *
 * Two details matter and are easy to get wrong:
 *
 * - **Sibling pairs are sorted before hashing.** That is what lets a proof be
 *   a bare list of hashes with no left/right direction bits.
 * - **Leaves and internal nodes carry different domain prefixes.** Without
 *   them, a 32-byte internal node could be replayed as an `(address, amount)`
 *   leaf and claimed against.
 *
 * `contracts/airdrop/src/lib.rs` pins the leaf encoding with the same test
 * vector this module's tests assert on, so a drift on either side fails a
 * test rather than producing an airdrop nobody can claim.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { StrKey } from "@stellar/stellar-sdk";

/** Domain-separation prefix for leaf hashes. */
const LEAF_DOMAIN = 0x00;

/** Domain-separation prefix for internal node hashes. */
const NODE_DOMAIN = 0x01;

/** Mirrors `MAX_PROOF_LEN` in the contract: a tree of up to 2^32 leaves. */
export const MAX_PROOF_LEN = 32;

/** One row of the allocation list, with `amount` already in base units. */
export interface Allocation {
  address: string;
  amount: bigint;
}

/** A recipient's claim bundle: everything `claim()` needs, as JSON-safe text. */
export interface AllocationProof {
  address: string;
  /** Base units, as a decimal string — `bigint` does not survive JSON. */
  amount: string;
  /** Sibling hashes, each 64 lowercase hex characters. */
  proof: string[];
}

/** The exported artifact an admin hands to recipients. */
export interface ProofSet {
  root: string;
  total: string;
  count: number;
  entries: AllocationProof[];
}

export interface MerkleTree {
  /** Root hash as 64 lowercase hex characters. */
  root: string;
  /** Layers bottom-up; `layers[0]` are the leaves, the last holds the root. */
  layers: Uint8Array[][];
  allocations: Allocation[];
}

/* ── Byte helpers ──────────────────────────────────────────────────── */

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Encode an `i128` as 16 big-endian bytes, two's complement — the same bytes
 * `i128::to_be_bytes()` produces in the contract.
 */
export function encodeI128BE(value: bigint): Uint8Array {
  const MIN = -(2n ** 127n);
  const MAX = 2n ** 127n - 1n;
  if (value < MIN || value > MAX) {
    throw new Error("Amount does not fit in an i128");
  }

  let v = value < 0n ? (1n << 128n) + value : value;
  const out = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/* ── Hashing ───────────────────────────────────────────────────────── */

/** `keccak256(0x00 || ascii(strkey) || be_i128(amount))`. */
export function leafHash(address: string, amount: bigint): Uint8Array {
  const strkey = new Uint8Array(address.length);
  for (let i = 0; i < address.length; i++) {
    const code = address.charCodeAt(i);
    if (code > 0x7f) {
      throw new Error("Address must be an ASCII strkey");
    }
    strkey[i] = code;
  }

  return keccak_256(
    concatBytes(
      new Uint8Array([LEAF_DOMAIN]),
      strkey,
      encodeI128BE(amount),
    ),
  );
}

/** `keccak256(0x01 || min(a, b) || max(a, b))`. */
export function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [first, second] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  return keccak_256(
    concatBytes(new Uint8Array([NODE_DOMAIN]), first, second),
  );
}

/* ── Tree ──────────────────────────────────────────────────────────── */

/**
 * Build the tree over `allocations`.
 *
 * Leaf order is the order given, so the caller controls it; an odd node at the
 * end of a layer is promoted unchanged rather than hashed with itself, which
 * would let it stand in for its own parent.
 */
export function buildTree(allocations: Allocation[]): MerkleTree {
  if (allocations.length === 0) {
    throw new Error("Cannot build a Merkle tree from an empty allocation list");
  }

  const leaves = allocations.map((a) => leafHash(a.address, a.amount));
  const layers: Uint8Array[][] = [leaves];

  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(
        i + 1 < current.length
          ? hashPair(current[i], current[i + 1])
          : current[i],
      );
    }
    layers.push(next);
  }

  return {
    root: toHex(layers[layers.length - 1][0]),
    layers,
    allocations,
  };
}

/** The sibling hashes proving `allocations[index]` belongs to the root. */
export function getProof(tree: MerkleTree, index: number): string[] {
  if (index < 0 || index >= tree.allocations.length) {
    throw new Error("Allocation index out of range");
  }

  const proof: string[] = [];
  let idx = index;

  for (let depth = 0; depth < tree.layers.length - 1; depth++) {
    const layer = tree.layers[depth];
    const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (sibling < layer.length) {
      proof.push(toHex(layer[sibling]));
    }
    idx = Math.floor(idx / 2);
  }

  return proof;
}

/** Re-run the contract's verification locally. */
export function verifyProof(
  address: string,
  amount: bigint,
  proof: string[],
  root: string,
): boolean {
  if (amount <= 0n || proof.length > MAX_PROOF_LEN) return false;

  let computed: Uint8Array;
  try {
    computed = leafHash(address, amount);
    for (const sibling of proof) {
      computed = hashPair(computed, fromHex(sibling));
    }
  } catch {
    return false;
  }

  return toHex(computed) === root.toLowerCase().replace(/^0x/, "");
}

/** The full export: root, totals, and every recipient's proof. */
export function buildProofSet(tree: MerkleTree): ProofSet {
  const total = tree.allocations.reduce((sum, a) => sum + a.amount, 0n);

  return {
    root: tree.root,
    total: total.toString(),
    count: tree.allocations.length,
    entries: tree.allocations.map((a, i) => ({
      address: a.address,
      amount: a.amount.toString(),
      proof: getProof(tree, i),
    })),
  };
}

/* ── CSV parsing ───────────────────────────────────────────────────── */

export interface CsvParseResult {
  allocations: Allocation[];
  /** Human-readable problems, one per rejected row. */
  errors: string[];
  total: bigint;
}

function isValidStrkey(address: string): boolean {
  return (
    StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address)
  );
}

/**
 * Scale a decimal display amount to base units without going through
 * `Number`, which silently loses precision past 2^53.
 */
export function parseDecimalAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${input}" is not a positive decimal amount`);
  }

  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new Error(
      `"${input}" has more than ${decimals} decimal places`,
    );
  }

  return BigInt(whole + frac.padEnd(decimals, "0"));
}

/**
 * Parse an `address,amount` CSV into allocations.
 *
 * Tolerates a header row, blank lines, `#` comments, and either comma or
 * semicolon separators. Rejected rows are reported with their line number
 * rather than dropped silently — a typo'd address in an airdrop list means a
 * recipient who can never claim, so it has to be visible before publishing.
 */
export function parseAllocationsCsv(
  csv: string,
  decimals: number,
): CsvParseResult {
  const allocations: Allocation[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();

  const lines = csv.split(/\r?\n/);

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;

    const cells = line.split(/[,;]/).map((c) => c.trim());
    if (cells.length < 2) {
      errors.push(`Line ${lineNo}: expected "address,amount"`);
      return;
    }

    const address = cells[0].toUpperCase();
    const amountText = cells[1];

    // Skip a header row rather than reporting it as a bad address.
    if (i === 0 && !isValidStrkey(address) && /address/i.test(cells[0])) {
      return;
    }

    if (!isValidStrkey(address)) {
      errors.push(`Line ${lineNo}: "${cells[0]}" is not a valid Stellar address`);
      return;
    }

    const previous = seen.get(address);
    if (previous !== undefined) {
      errors.push(
        `Line ${lineNo}: address already allocated on line ${previous}`,
      );
      return;
    }

    let amount: bigint;
    try {
      amount = parseDecimalAmount(amountText, decimals);
    } catch (err) {
      errors.push(
        `Line ${lineNo}: ${err instanceof Error ? err.message : "invalid amount"}`,
      );
      return;
    }

    if (amount <= 0n) {
      errors.push(`Line ${lineNo}: amount must be greater than zero`);
      return;
    }

    seen.set(address, lineNo);
    allocations.push({ address, amount });
  });

  return {
    allocations,
    errors,
    total: allocations.reduce((sum, a) => sum + a.amount, 0n),
  };
}
