import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ARTIFACT_DIR = path.resolve(import.meta.dirname, '../../artifacts/tier1-annotation-smoke');

test.beforeAll(() => {
	if (!fs.existsSync(ARTIFACT_DIR)) {
		fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	}
});

test('house2 functional flow', async ({ page }) => {
	console.log('Loading house2 model...');
	await page.goto('/?annotate=tier1&devModel=house2_model-eval.json');

	// Wait for Svelte page to render and the annotation panel to mount
	const panel = page.getByLabel('Tier-1 annotation mode');
	await expect(panel).toBeVisible({ timeout: 15000 });

	// Wait for the first selectable unit option to be populated
	const selectOption = page.locator('select[aria-label="Classification unit"] option');
	await expect(selectOption.first()).toBeAttached({ timeout: 20000 });

	const firstUnitId = await selectOption.first().getAttribute('value');
	console.log(`First selectable unit: ${firstUnitId}`);
	expect(firstUnitId).not.toBeNull();

	// Select the Wall role button
	const wallButton = page.getByRole('button', { name: '1 Wall' });
	await expect(wallButton).toBeVisible();
	await wallButton.click();

	// Verify that the status label or button state reflects the selection
	await expect(wallButton).toHaveClass(/active/);

	// Click "Save unit"
	const saveButton = page.getByRole('button', { name: 'Save unit' });
	await saveButton.click();

	// Verify annotation text area is populated
	const showJsonButton = page.getByRole('button', { name: 'Show JSON' });
	await showJsonButton.click();

	const textarea = page.locator('textarea[placeholder="Annotation JSON text for copy/paste"]');
	await expect(textarea).not.toBeEmpty();
	const text = await textarea.inputValue();
	const json = JSON.parse(text);

	expect(json.modelId).toBe('house2_model-eval.json');
	expect(json.annotations.length).toBeGreaterThan(0);
	expect(json.annotations[0].expectedSurfaceRole).toBe('wall');

	// Take screenshot
	const screenshotPath = path.join(ARTIFACT_DIR, 'house2_smoke.png');
	await page.screenshot({ path: screenshotPath });
	console.log(`house2 screenshot saved to ${screenshotPath}`);
});

test('presentation20 scalability flow', async ({ page }) => {
	console.log('Loading presentation20 model...');
	await page.goto('/?annotate=tier1&devModel=presentation20_model-eval.json');

	const panel = page.getByLabel('Tier-1 annotation mode');
	await expect(panel).toBeVisible({ timeout: 30000 });

	const selectOption = page.locator('select[aria-label="Classification unit"] option');
	// Expose first selectable unit under 3 seconds in the profile; Playwright wait can be up to 15s to be safe
	await expect(selectOption.first()).toBeAttached({ timeout: 15000 });

	const firstUnitId = await selectOption.first().getAttribute('value');
	console.log(`First selectable unit for presentation20: ${firstUnitId}`);
	expect(firstUnitId).not.toBeNull();

	// Take screenshot of the loaded model and first unit exposed
	const screenshotPath = path.join(ARTIFACT_DIR, 'presentation20_smoke.png');
	await page.screenshot({ path: screenshotPath });
	console.log(`presentation20 screenshot saved to ${screenshotPath}`);
});
