import { defineConfig } from '@playwright/test';

const host = '127.0.0.1';
const appPort = Number(process.env.REAL_E2E_APP_PORT || 5317);
const backendPort = Number(process.env.REAL_E2E_BACKEND_PORT || 5318);
const appUrl = `http://${host}:${appPort}`;
const backendUrl = `http://${host}:${backendPort}`;

export default defineConfig({
	testDir: './e2e-real',
	outputDir: './output/playwright/real-results',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 45_000,
	expect: { timeout: 8_000 },
	reporter: 'list',
	use: {
		baseURL: appUrl,
		browserName: 'chromium',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	webServer: [
		{
			command: 'node ./scripts/real-e2e/mock-backend.mjs',
			url: `${backendUrl}/_test/health`,
			reuseExistingServer: false,
			timeout: 30_000,
			env: {
				REAL_E2E_BACKEND_PORT: String(backendPort)
			}
		},
		{
			command: 'node ./scripts/real-e2e/start-app.mjs',
			url: `${appUrl}/healthz`,
			reuseExistingServer: false,
			timeout: 60_000,
			env: {
				HOST: host,
				PORT: String(appPort),
				ORIGIN: appUrl,
				SHUTDOWN_TIMEOUT: '2',
				API_BASE_URL: `${backendUrl}/v1/api`,
				PUBLIC_SITE_URL: appUrl,
				APP_RELEASE: 'real-app-e2e-v1',
				PUBLIC_API_KEY: 'real-e2e-public-key-not-secret',
				USER_API_KEY: 'real-e2e-user-key-not-secret',
				ADMIN_BFF_API_KEY: 'real-e2e-admin-bff-key-not-secret',
				OPENAI_API_KEY: 'real-e2e-openai-placeholder-not-secret',
				SEO_AGENT_AUTO_PUBLISH: 'false',
				INOXPRAN_SEO_AGENT_AUTO_PUBLISH: 'false',
				AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH: 'false',
				CONTENT_LEARNING_AUTO_APPLY: 'false',
				OPENCLAW_UPDATE_ENABLED: 'false',
				OPENCLAW_NO_AUTO_UPDATE: '1'
			}
		}
	]
});
