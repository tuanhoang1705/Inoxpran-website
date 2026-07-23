import { sanitizeOpenClawClientPayload } from './openclawClientPayload.js';

const REVISION = /^[A-Za-z0-9._:/@+-]{7,160}$/;
const REFERENCE = /^[A-Za-z0-9._:/@+-]{3,160}$/;
const SECRET_ASSIGNMENT =
	/\b(?:[A-Za-z0-9_.-]*(?:token|secret|password|credential|authorization)|api[_-]?key)\b\s*[:=]/i;
const SECRET_URL_PARAMETER =
	/[?&#](?:token|access_token|auth|authorization|api[_-]?key|secret|password|credential)=/i;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasDisallowedControlCharacter = (value) =>
	[...value].some((character) => {
		const code = character.charCodeAt(0);
		return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
	});

const hasExactKeys = (value, required, optional = []) => {
	if (!isRecord(value)) return false;
	const keys = Object.keys(value);
	const allowed = new Set([...required, ...optional]);
	return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
};

const boundedText = (value, { min, max }) => {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	if (
		normalized.length < min ||
		normalized.length > max ||
		hasDisallowedControlCharacter(normalized)
	) {
		return null;
	}
	return normalized;
};

const safeVerificationRefs = (value) => {
	if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
	const references = value.map((item) => (typeof item === 'string' ? item.trim() : ''));
	return references.every((item) => REFERENCE.test(item)) ? references : null;
};

const safeArchitectureReport = (value) => {
	const fields = ['failedLayer', 'rootCause', 'redesignScope', 'backwardCompatibility'];
	if (!hasExactKeys(value, fields)) return null;
	const report = {
		failedLayer: boundedText(value.failedLayer, { min: 3, max: 160 }),
		rootCause: boundedText(value.rootCause, { min: 20, max: 1500 }),
		redesignScope: boundedText(value.redesignScope, { min: 12, max: 1000 }),
		backwardCompatibility: boundedText(value.backwardCompatibility, { min: 12, max: 1000 })
	};
	return Object.values(report).every((item) => item !== null) ? report : null;
};

const containsSecretMaterial = (value) => {
	const serialized = JSON.stringify(value);
	return (
		SECRET_ASSIGNMENT.test(serialized) ||
		SECRET_URL_PARAMETER.test(serialized) ||
		JSON.stringify(sanitizeOpenClawClientPayload(value)) !== serialized
	);
};

export const safeQaCreateBody = (body) => {
	if (!hasExactKeys(body, ['environment'])) return null;
	const environment = typeof body.environment === 'string' ? body.environment.trim() : '';
	return ['local', 'staging'].includes(environment) ? { environment } : null;
};

export const safeQaEmptyActionBody = (body) =>
	isRecord(body) && Object.keys(body).length === 0 ? {} : null;

export const safeQaResumeBody = (body) => {
	const emptyBody = safeQaEmptyActionBody(body);
	if (emptyBody) return emptyBody;
	if (
		!hasExactKeys(body, ['acknowledgeCodeChange', 'appliedCodeRevision', 'actionEvidence']) ||
		body.acknowledgeCodeChange !== true ||
		typeof body.appliedCodeRevision !== 'string'
	) {
		return null;
	}

	const appliedCodeRevision = body.appliedCodeRevision.trim();
	if (!REVISION.test(appliedCodeRevision)) return null;
	const source = body.actionEvidence;
	if (
		!hasExactKeys(
			source,
			['changedLayer', 'changeSummary', 'verificationRefs'],
			['architectureReport']
		)
	) {
		return null;
	}
	const actionEvidence = {
		changedLayer: boundedText(source.changedLayer, { min: 3, max: 160 }),
		changeSummary: boundedText(source.changeSummary, { min: 12, max: 1000 }),
		verificationRefs: safeVerificationRefs(source.verificationRefs)
	};
	if (Object.values(actionEvidence).some((item) => item === null)) return null;
	if (Object.hasOwn(source, 'architectureReport')) {
		actionEvidence.architectureReport = safeArchitectureReport(source.architectureReport);
		if (!actionEvidence.architectureReport) return null;
	}

	const safeBody = { acknowledgeCodeChange: true, appliedCodeRevision, actionEvidence };
	return containsSecretMaterial(safeBody) ? null : safeBody;
};
