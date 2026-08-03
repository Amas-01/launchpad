import { test, expect } from '@playwright/test';
import { createMockFreighterProvider, FreighterScenarios } from './mocks/mockFreighter';

test.describe('Deploy flow', () => {
  test('deploy a token and show correct supply on dashboard', async ({ page }) => {
    // inject mock freighter before navigation
    await page.addInitScript(createMockFreighterProvider(FreighterScenarios.connected));

    // Go to deploy page
    await page.goto('/deploy');

    // Connect wallet
    await page.getByRole('button', { name: /connect wallet/i }).click();

    // Fill out form - step 1: metadata
    await page.getByLabel(/token name/i).fill('E2E Token');
    await page.getByLabel(/symbol/i).fill('E2E');
    await page.getByLabel(/decimals/i).fill('2');
    await page.getByRole('button', { name: /continue/i }).click();

    // step 2: supply
    await page.getByLabel(/initial supply/i).fill('1000');
    await page.getByLabel(/max supply/i).fill('1000');
    await page.getByRole('button', { name: /continue/i }).click();

    // step 3: admin
    await page.getByLabel(/admin address/i).fill('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    await page.getByRole('button', { name: /continue/i }).click();

    // step 4: review & deploy
    await page.getByRole('button', { name: /check/i }).click();
    await page.getByRole('button', { name: /deploy token/i }).click();

    // Wait for navigation to dashboard (or success indicator)
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });

    // Assert the total supply or token supply is displayed on the dashboard
    // Be permissive in the selector: check for the token name then the numeric supply nearby
    await expect(page.getByText(/E2E Token/)).toBeVisible();
    await expect(page.getByText(/1000/)).toBeVisible();
  });
});
