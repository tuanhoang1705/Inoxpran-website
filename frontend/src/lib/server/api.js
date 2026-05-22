import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_API_BASE = 'http://localhost:3056/v1/api';

const readEnvFileValue = (key) => {
	const candidates = [
		path.resolve(process.cwd(), '.env'),
		path.resolve(process.cwd(), '..', '.env')
	];
	try {
		for (const envPath of candidates) {
			if (!fs.existsSync(envPath)) continue;
			const content = fs.readFileSync(envPath, 'utf8');
			for (const line of content.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#')) continue;
				const [rawKey, ...rest] = trimmed.split('=');
				if (rawKey !== key) continue;
				const rawValue = rest.join('=').trim();
				return rawValue.replace(/^['"]|['"]$/g, '').trim();
			}
		}
	} catch {
		return undefined;
	}
	return undefined;
};

const API_BASE_URL = env.API_BASE_URL || readEnvFileValue('API_BASE_URL');
const API_KEY = env.API_KEY || readEnvFileValue('API_KEY');

const normalizeBase = (value) =>
	String(value || '')
		.trim()
		.replace(/\/$/, '');
export const API_BASE_CANDIDATES = Array.from(
	new Set([API_BASE_URL, DEFAULT_API_BASE].map(normalizeBase).filter(Boolean))
);
export const API_BASE = API_BASE_CANDIDATES[0] || normalizeBase(DEFAULT_API_BASE);
export const API_KEY_HEADER = API_KEY;
