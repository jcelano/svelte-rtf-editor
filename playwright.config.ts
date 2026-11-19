import { defineConfig, devices } from '@playwright/test';

// The browser tests: what a test DOM cannot show (where the caret goes, what a key press does
// after a dialog closes, what a real paste brings in). `npm run test:e2e` runs them in the three
// engines the editor is used in; `npm run test:e2e -- --project=firefox` in one.
//
// A test that cannot be made in an engine says so where it is skipped: WebKit rewrites the HTML
// a script puts on the clipboard, so a paste of Word's own marks cannot be made there.
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? 'github' : 'list',
	use: { baseURL: 'http://localhost:4173' },
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// A browser already on the machine, where the one Playwright downloads is not used.
				launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
				// (Chromium's own names: the other two know no such permission.)
				permissions: ['clipboard-read', 'clipboard-write']
			}
		},
		{
			name: 'firefox',
			use: {
				...devices['Desktop Firefox'],
				// A script may write the clipboard and read it, as a test's paste needs.
				launchOptions: {
					firefoxUserPrefs: {
						'dom.events.asyncClipboard.readText': true,
						'dom.events.asyncClipboard.clipboardItem': true,
						'dom.events.testing.asyncClipboard': true
					}
				}
			}
		},
		// Safari's engine. (On a Mac it takes no mouse while the screen is locked.)
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } }
	],
	webServer: {
		command: 'npm run dev -- --port 4173 --strictPort',
		url: 'http://localhost:4173/e2e',
		reuseExistingServer: !process.env.CI
	}
});
