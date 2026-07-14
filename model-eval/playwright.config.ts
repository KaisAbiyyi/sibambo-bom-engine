import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	timeout: 180000,
	expect: {
		timeout: 10000
	},
	fullyParallel: false,
	workers: 1,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:5173',
		trace: 'on-first-retry',
		headless: true,
		viewport: { width: 1280, height: 800 }
	},
	webServer: {
		command: 'bun run dev --port 5173',
		url: 'http://localhost:5173',
		reuseExistingServer: !process.env.CI,
		timeout: 60000
	}
});
