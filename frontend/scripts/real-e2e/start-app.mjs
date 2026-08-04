import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDirectory, '..', '..');
const entrypoint = path.join(frontendRoot, 'build', 'index.js');

if (!fs.existsSync(entrypoint)) {
	throw new Error('Missing frontend/build/index.js; run npm run build before test:e2e:real');
}

const apiBaseUrl = new URL(String(process.env.API_BASE_URL || ''));
if (!['127.0.0.1', 'localhost'].includes(apiBaseUrl.hostname)) {
	throw new Error('Real-app E2E refuses to connect to a non-loopback backend');
}

Object.assign(process.env, {
	NODE_ENV: 'production',
	SEO_AGENT_AUTO_PUBLISH: 'false',
	INOXPRAN_SEO_AGENT_AUTO_PUBLISH: 'false',
	AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH: 'false',
	CONTENT_LEARNING_AUTO_APPLY: 'false',
	OPENCLAW_UPDATE_ENABLED: 'false',
	OPENCLAW_NO_AUTO_UPDATE: '1'
});

await import(pathToFileURL(entrypoint).href);
