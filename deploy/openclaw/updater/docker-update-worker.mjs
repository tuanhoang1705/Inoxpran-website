import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

process.umask(0o077);

const requestPath = path.resolve(process.argv[2] || '');
const projectRoot = path.resolve(process.env.OPENCLAW_PROJECT_ROOT || '/var/www/project/Inoxpran-Website');
const runtimeDir = path.resolve(process.env.OPENCLAW_UPDATE_RUNTIME_DIR || path.join(projectRoot, 'deploy/openclaw/update-runtime'));
const backupRoot = path.resolve(process.env.OPENCLAW_UPDATE_BACKUP_DIR || path.join(projectRoot, 'deploy/openclaw/update-backups'));
const composeFile = path.join(projectRoot, 'docker-compose.yml');
const statusFile = path.join(runtimeDir, 'status.json');
const image = String(process.env.OPENCLAW_UPDATE_IMAGE || 'openclaw/openclaw:latest').trim();
const rollbackImage = 'inoxpran/openclaw:rollback';
const terminalLogLimit = 12000;
const validImages = new Set(['openclaw/openclaw:latest', 'ghcr.io/openclaw/openclaw:latest']);

let request = null;
let previousImageId = '';
let previousVersion = '';
let backupDir = '';
let replacementStarted = false;

const sanitize = (value) => String(value || '')
	.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]')
	.replace(/fc-[A-Za-z0-9_-]{12,}/g, '[redacted]')
	.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
	.replace(/([?#&](?:token|auth|access_token)=)[^&#\s"']+/gi, '$1[redacted]')
	.slice(-terminalLogLimit);

const atomicWriteJson = (filePath, payload) => {
	const tempPath = `${filePath}.${process.pid}.tmp`;
	writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o660 });
	renameSync(tempPath, filePath);
};

const writeStatus = (state, details = {}) => {
	const now = new Date().toISOString();
	atomicWriteJson(statusFile, {
		schemaVersion: 1,
		requestId: request?.requestId || '',
		state,
		phase: details.phase || state,
		message: sanitize(details.message || ''),
		fromVersion: details.fromVersion ?? previousVersion,
		toVersion: details.toVersion || '',
		backupDir: backupDir ? path.relative(projectRoot, backupDir) : '',
		error: sanitize(details.error || ''),
		startedAt: details.startedAt || request?.startedAt || now,
		updatedAt: now,
		finishedAt: details.finishedAt || (['completed', 'failed', 'rolled_back'].includes(state) ? now : '')
	});
};

const run = (command, args, { timeoutMs = 10 * 60 * 1000, allowFailure = false } = {}) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: projectRoot,
			env: { ...process.env, HOME: '/tmp' },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		const append = (chunk) => {
			output = `${output}${chunk.toString()}`.slice(-terminalLogLimit);
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			const result = { code: Number(code ?? 1), signal, output: sanitize(output).trim() };
			if (result.code === 0 || allowFailure) resolve(result);
			else reject(new Error(`${command} exited ${result.code}: ${result.output}`));
		});
	});

const docker = (args, options) => run('docker', args, options);
const compose = (args, options) => docker(['compose', '--project-directory', projectRoot, '-f', composeFile, ...args], options);

const inspectContainerState = async () => {
	const result = await docker(['inspect', 'app_openclaw', '--format', '{{json .State}}'], { allowFailure: true });
	if (result.code !== 0 || !result.output) return null;
	try {
		return JSON.parse(result.output);
	} catch {
		return null;
	}
};

const probeGatewayHealthEndpoint = async () => {
	const result = await docker([
		'exec',
		'app_openclaw',
		'node',
		'-e',
		"fetch('http://127.0.0.1:18789/healthz').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
	], { allowFailure: true, timeoutMs: 15000 });
	return result.code === 0;
};

const waitForHealthy = async (timeoutMs = 150000) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const state = await inspectContainerState();
		// New OpenClaw images may use a long Docker health interval. Probe the
		// Gateway endpoint directly so a healthy upgrade is not rolled back while
		// waiting for Docker's next scheduled healthcheck.
		if (state?.Running && (
			state?.Health?.Status === 'healthy'
			|| await probeGatewayHealthEndpoint()
		)) return state;
		if (state?.Status === 'exited' || state?.Dead) {
			throw new Error(`OpenClaw container stopped before becoming healthy (exit ${state.ExitCode ?? 'unknown'})`);
		}
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}
	throw new Error('OpenClaw health check timed out');
};

const getContainerImageId = async () => (await docker([
	'inspect', 'app_openclaw', '--format', '{{.Image}}'
])).output.trim();

const getTaggedImageId = async () => (await docker([
	'image', 'inspect', image, '--format', '{{.Id}}'
])).output.trim();

const getRunningVersion = async () => {
	const result = await docker(['exec', 'app_openclaw', 'openclaw', '--version'], { allowFailure: true, timeoutMs: 30000 });
	return result.code === 0 ? result.output.replace(/^OpenClaw\s+/i, '').trim() : '';
};

const validateRequest = (payload) => {
	if (!payload || payload.schemaVersion !== 1 || payload.action !== 'update-openclaw') {
		throw new Error('Unsupported update request');
	}
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.requestId || '')) {
		throw new Error('Invalid update request id');
	}
	const requestedAt = new Date(payload.requestedAt).getTime();
	if (!Number.isFinite(requestedAt) || Math.abs(Date.now() - requestedAt) > 15 * 60 * 1000) {
		throw new Error('Expired update request');
	}
	if (!validImages.has(image)) throw new Error('Update image is not allowlisted');
	if (!composeFile.startsWith(`${projectRoot}${path.sep}`) || !existsSync(composeFile)) {
		throw new Error('Compose project is unavailable');
	}
	return payload;
};

const createBackup = async () => {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	backupDir = path.join(backupRoot, `openclaw-${stamp}-${request.requestId.slice(0, 8)}`);
	await mkdir(backupDir, { recursive: true, mode: 0o700 });
	await run('tar', [
		'-czf', path.join(backupDir, 'state.tgz'),
		'.env',
		'deploy/openclaw/openclaw.json5',
		'deploy/openclaw/data'
	], { timeoutMs: 5 * 60 * 1000 });
	atomicWriteJson(path.join(backupDir, 'metadata.json'), {
		requestId: request.requestId,
		createdAt: new Date().toISOString(),
		image,
		previousImageId,
		previousVersion
	});
};

const reloadNginx = async () => {
	await docker(['exec', 'app_nginx', 'nginx', '-t'], { timeoutMs: 30000 });
	await docker(['exec', 'app_nginx', 'nginx', '-s', 'reload'], { timeoutMs: 30000 });
};

const verifyGateway = async () => {
	await waitForHealthy();
	const health = await docker(['exec', 'app_openclaw', 'openclaw', 'health', '--json'], {
		allowFailure: true,
		timeoutMs: 60000
	});
	if (health.code !== 0) throw new Error(`OpenClaw health command failed: ${health.output}`);
	await reloadNginx();
};

const rollback = async (rootError) => {
	writeStatus('running', {
		phase: 'rolling_back',
		message: 'Update failed. Restoring the previous OpenClaw image.',
		error: rootError.message
	});
	try {
		await docker(['image', 'tag', rollbackImage, image]);
		await compose(['up', '-d', '--no-deps', '--force-recreate', 'openclaw'], { timeoutMs: 5 * 60 * 1000 });
		await verifyGateway();
		const restoredVersion = await getRunningVersion();
		writeStatus('rolled_back', {
			phase: 'rolled_back',
			message: `Update failed; OpenClaw was restored to ${restoredVersion || previousVersion || 'the previous version'}.`,
			toVersion: restoredVersion,
			error: rootError.message
		});
	} catch (rollbackError) {
		writeStatus('failed', {
			phase: 'rollback_failed',
			message: 'Update and automatic rollback both failed. Manual recovery is required.',
			error: `${rootError.message}; rollback: ${rollbackError.message}`
		});
	}
};

try {
	request = validateRequest(JSON.parse(readFileSync(requestPath, 'utf8')));
	request.startedAt = new Date().toISOString();
	writeStatus('running', { phase: 'preflight', message: 'Checking the current OpenClaw image and creating a rollback point.' });

	previousImageId = await getContainerImageId();
	previousVersion = await getRunningVersion();
	if (!/^sha256:[a-f0-9]{64}$/i.test(previousImageId)) throw new Error('Unable to identify the current OpenClaw image');

	await docker(['image', 'tag', previousImageId, rollbackImage]);
	await createBackup();

	writeStatus('running', { phase: 'pulling', message: 'Pulling the latest stable OpenClaw image.' });
	await compose(['pull', 'openclaw'], { timeoutMs: 12 * 60 * 1000 });
	const targetImageId = await getTaggedImageId();

	if (targetImageId === previousImageId) {
		writeStatus('completed', {
			phase: 'up_to_date',
			message: `OpenClaw ${previousVersion || ''} is already up to date.`.trim(),
			toVersion: previousVersion
		});
		process.exit(0);
	}

	writeStatus('running', { phase: 'replacing', message: 'Replacing the OpenClaw container with the new image.' });
	replacementStarted = true;
	await compose(['up', '-d', '--no-deps', '--force-recreate', 'openclaw'], { timeoutMs: 5 * 60 * 1000 });

	writeStatus('running', { phase: 'verifying', message: 'Waiting for Gateway health checks and validating Nginx routing.' });
	await verifyGateway();
	const updatedVersion = await getRunningVersion();

	writeStatus('completed', {
		phase: 'updated',
		message: `OpenClaw updated successfully from ${previousVersion || 'the previous version'} to ${updatedVersion || 'the latest stable version'}.`,
		toVersion: updatedVersion
	});
} catch (error) {
	const safeError = new Error(sanitize(error?.message || error));
	if (replacementStarted && previousImageId) await rollback(safeError);
	else writeStatus('failed', { phase: 'failed', message: 'OpenClaw update failed before replacement; the running container was not changed.', error: safeError.message });
	process.exitCode = 1;
}
