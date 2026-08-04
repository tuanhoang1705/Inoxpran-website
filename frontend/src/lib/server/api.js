import { building, dev } from '$app/environment';
import fs from 'node:fs';
import path from 'node:path';
import {
	assertApiRuntimeConfig,
	resolveApiBaseForExecution,
	resolveApiRuntimeConfig
} from '$lib/server/apiRuntimeConfig.js';

const DEFAULT_API_BASE = 'http://localhost:3056/v1/api';
const IS_PRODUCTION = !dev;

const resolveRepositoryRootEnvPath = () => {
	const cwd = process.cwd();
	return path.basename(cwd).toLowerCase() === 'frontend'
		? path.resolve(cwd, '..', '.env')
		: path.resolve(cwd, '.env');
};

const readLocalRootEnv = () => {
	if (IS_PRODUCTION) return {};
	const envPath = resolveRepositoryRootEnvPath();
	try {
		if (!fs.existsSync(envPath)) return {};
		const values = {};
		for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const [rawKey, ...rest] = trimmed.split('=');
			const key = String(rawKey || '').trim();
			if (!key) continue;
			values[key] = rest
				.join('=')
				.trim()
				.replace(/^['"]|['"]$/g, '')
				.trim();
		}
		return values;
	} catch {
		return {};
	}
};

const localRootEnv = readLocalRootEnv();

export const readServerEnvValue = (name) =>
	String(process.env[name] || (IS_PRODUCTION ? '' : localRootEnv[name]) || '').trim();

const runtimeConfig = resolveApiRuntimeConfig({
	runtimeEnv: process.env,
	localEnv: localRootEnv,
	production: IS_PRODUCTION
});

// SvelteKit evaluates server modules while building. Validate on the actual
// production server boot, where runtime secrets have been injected.
if (IS_PRODUCTION && !building) {
	assertApiRuntimeConfig(runtimeConfig);
}

const normalizeBase = (value) =>
	String(value || '')
		.trim()
		.replace(/\/$/, '');
const primaryApiBase = resolveApiBaseForExecution({
	apiBaseUrl: runtimeConfig.apiBaseUrl,
	developmentFallback: DEFAULT_API_BASE,
	development: dev
});
export const API_BASE_CANDIDATES = Array.from(
	new Set(
		[primaryApiBase, ...(IS_PRODUCTION ? [] : [DEFAULT_API_BASE])]
			.map(normalizeBase)
			.filter(Boolean)
	)
);
export const API_BASE = API_BASE_CANDIDATES[0] || '';
export const PUBLIC_API_KEY_HEADER = runtimeConfig.publicApiKey;
export const USER_API_KEY_HEADER = runtimeConfig.userApiKey;
export const ADMIN_BFF_API_KEY_HEADER = runtimeConfig.adminBffApiKey;
