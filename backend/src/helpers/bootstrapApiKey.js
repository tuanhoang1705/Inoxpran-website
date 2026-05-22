'use strict';

const fs = require('fs');
const path = require('path');
const apikeyModel = require('../models/apiKey.model');

const DEFAULT_PERMISSIONS = ['PUBLIC', 'USER', 'ADMIN', 'ADMIN_SYSTEM'];
const API_KEY_TTL_FIELD = 'createdAt';

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

const getApiKey = () => process.env.API_KEY || readEnvFileValue('API_KEY');

const dropLegacyTtlIndex = async () => {
	try {
		const indexes = await apikeyModel.collection.indexes();
		const legacyIndex = indexes.find((index) => {
			const keys = index?.key || {};
			return (
				keys[API_KEY_TTL_FIELD] === 1 &&
				Object.prototype.hasOwnProperty.call(index, 'expireAfterSeconds')
			);
		});
		if (!legacyIndex?.name) return;
		await apikeyModel.collection.dropIndex(legacyIndex.name);
		console.info(`Dropped legacy API key TTL index: ${legacyIndex.name}`);
	} catch (error) {
		if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return;
		// A stale TTL index can delete the configured API key later. Log only; the
		// upsert below still lets the current process recover the key.
		console.warn('API key TTL index cleanup failed:', error?.message || error);
	}
};

const ensureApiKey = async () => {
	const key = getApiKey();
	if (!key) {
		console.warn('API_KEY missing; skip api key bootstrap.');
		return;
	}

	await dropLegacyTtlIndex();
	await apikeyModel.updateOne(
		{ key },
		{
			$set: { status: true },
			$setOnInsert: { createdAt: new Date() },
			$addToSet: { permissions: { $each: DEFAULT_PERMISSIONS } }
		},
		{ upsert: true }
	);
};

module.exports = { ensureApiKey, getApiKey };
