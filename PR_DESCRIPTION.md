# Pull Request: Network-Aware Token Deployment

## Overview
This PR transitions the token deployment hook (`useDeployToken`) from static environment variables to a dynamic, context-aware configuration using the network provider. It also fixes all type-checking and linting errors to stabilize the build.

## Key Changes
1. **Dynamic Network Selection**:
   * Updated `useDeployToken.ts` to consume `useNetwork()`.
   * Replaced `SOROBAN_RPC_URL` and `NETWORK_PASSPHRASE` constants with `networkConfig.rpcUrl` and `networkConfig.passphrase`.
   * Refactored the `initializeContract` helper signature to accept the dynamic network passphrase.

2. **Build Stabilization**:
   * Fixed `transactionSimulator.ts` calling `.footprint` by converting it to `getFootprint()`.
   * Escaped JSX double quotes in `StepReview.tsx`.
   * Integrated the new time-tracking state logic from `origin/master` in `NotificationCenter.tsx`.

3. **PR Scope Restoration**:
   * Reverted `AdminPanel.tsx` modifications to match `origin/master` exactly, excluding any unrelated Admin-related changes from this PR.

## Build Verification
Both TypeScript type-checking and ESLint checks pass with no errors:
* `npm run type-check` (Success, exit code 0)
* `npm run lint` (Success, exit code 0)
