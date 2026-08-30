/**
 * Shared contract-ID format validation.
 *
 * Stellar Soroban contract IDs are a capital-C followed by 55 base-32 (A-Z, 2-7)
 * characters — the same pattern the landing-page lookup validates client-side.
 *
 * This guard is intentionally cheap (pure regex — no network I/O) so it can
 * be called at the top of every API route and SSR page handler before any RPC
 * work begins.  An invalid ID is rejected immediately with a 400 response, which
 * keeps garbage values away from the RPC layer entirely.
 */

/** Stellar contract-ID format: C + 55 base-32 (A–Z, 2–7) chars (56 chars total). */
export const CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;

/**
 * Returns `true` when `contractId` matches the expected Stellar contract-ID
 * format.  Does **not** perform any on-chain validation.
 */
export function isValidContractId(contractId: string): boolean {
  return CONTRACT_ID_REGEX.test(contractId);
}
