import { defineConfig } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const isCi = Boolean(process.env.CI);
const isolatedPort = Number(process.env.PLAYWRIGHT_PORT || (isCi ? 5187 : 5173));
const serverHost = '127.0.0.1';
const localBaseUrl = `http://${serverHost}:${isolatedPort}`;

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	use: {
		baseURL: externalBaseUrl || localBaseUrl,
		trace: 'retain-on-failure'
	},
	webServer: externalBaseUrl
		? undefined
		: {
				// Bundle the four browser modules once into an ASCII OS-temp path,
				// then serve the immutable output from a loopback-only Node server.
				// This avoids Vite optimizer races in Unicode Windows workspaces.
				command: `node ./scripts/module-e2e/start-server.mjs --port ${isolatedPort}`,
				url: `${localBaseUrl}/__openclaw_e2e_ready`,
				reuseExistingServer: false,
				timeout: 60_000
			}
});
