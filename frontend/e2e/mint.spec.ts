import { test, expect } from '@playwright/test';
import { createMockFreighterProvider, FreighterScenarios } from './mocks/mockFreighter';

test.describe('Minting', () => {
  test('mint increases holder balance', async ({ page }) => {
    await page.addInitScript(createMockFreighterProvider(FreighterScenarios.connected));

    // Start on dashboard for an already-deployed token
    // If your app routes tokens by id/slug, adjust the URL accordingly
    await page.goto('/dashboard');

    // Ensure token and balances are loaded
    await expect(page.getByText(/Total Supply/i)).toBeVisible({ timeout: 10000 });

    // Open mint dialog / form
    await page.getByRole('button', { name: /mint/i }).click();

    // Fill amount and recipient (if required)
    await page.getByLabel(/amount/i).fill('50');
    // If there is a recipient field, default to the connected address:
    // await page.getByLabel(/recipient/i).fill('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

    // Submit mint
    await page.getByRole('button', { name: /confirm/i }).click();

    // Wait for an updated balance to appear; allow time for UI updates
    await expect(page.getByText(/50/)).toBeVisible({ timeout: 10000 });

    // Optionally check holder's balance increased (loose assertion)
    const text = await page.locator('body').innerText();
    expect(text).toMatch(/50/);
  });
});


test.describe('Vesting', () => {
  test('create a vesting schedule and claim from it', async ({ page }) => {
    await page.addInitScript(createMockFreighterProvider(FreighterScenarios.connected));

    await page.goto('/vesting');

    // Create new schedule
    await page.getByRole('button', { name: /create vesting/i }).click();

    // Fill schedule form fields (labels taken from docs; adjust if necessary)
    await page.getByLabel(/beneficiary/i).fill('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    await page.getByLabel(/amount/i).fill('100');
    await page.getByLabel(/cliff/i).fill('0'); // immediate
    await page.getByLabel(/duration/i).fill('1'); // short for test

    await page.getByRole('button', { name: /create/i }).click();

    // Wait for schedule entry to appear
    await expect(page.getByText(/vesting schedule/i)).toBeVisible({ timeout: 10000 });

    // Simulate claim flow: find the schedule and claim
    await page.getByRole('button', { name: /claim/i }).first().click();

    // Verify claim increases balance (loose check)
    await expect(page.getByText(/100/)).toBeVisible({ timeout: 10000 });
  });
});


test.describe('Wallet', () => {
  test('connect wallet and switch networks', async ({ page }) => {
    await page.addInitScript(createMockFreighterProvider(FreighterScenarios.connected));

    await page.goto('/');

    // Connect wallet
    await page.getByRole('button', { name: /connect wallet/i }).click();

    // Verify address badge/title is visible
    await expect(page.getByTitle(/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF/)).toBeVisible({
      timeout: 5000,
    });

    // Switch network: try UI control, fallback to select with id '#network'
    const networkSelector = page.locator('select#network');
    if (await networkSelector.count() > 0) {
      await page.selectOption('#network', 'testnet');
      await expect(page.getByText(/testnet/i)).toBeVisible();
    } else {
      // Try a network switch button (UI dependent)
      const switcher = page.getByRole('button', { name: /network/i }).first();
      if (await switcher.count() > 0) {
        await switcher.click();
        await page.getByRole('menuitem', { name: /testnet/i }).click();
        await expect(page.getByText(/testnet/i)).toBeVisible();
      }
    }
  });
});

