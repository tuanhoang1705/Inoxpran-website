import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const HOST = '127.0.0.1';
const READY_PATH = '/__openclaw_e2e_ready';
const HARNESS_PATH = '/favicon.png';
const TEMP_PREFIX = 'inoxpran-openclaw-module-e2e-';
const HARNESS_HTML =
	'<!doctype html><html><head><meta charset="utf-8"><title>OpenClaw module E2E</title></head><body></body></html>';

const parsePort = () => {
	const portArgumentIndex = process.argv.indexOf('--port');
	const rawPort =
		portArgumentIndex >= 0 ? process.argv[portArgumentIndex + 1] : process.env.PLAYWRIGHT_PORT;
	const port = Number(rawPort);
	if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
		throw new Error('Module E2E server requires a port between 1024 and 65535');
	}
	return port;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const moduleEntries = {
	actionIdempotency: path.join(projectRoot, 'src', 'lib', 'openclaw', 'actionIdempotency.js'),
	activityCenter: path.join(projectRoot, 'src', 'lib', 'openclaw', 'activityCenter.js'),
	executionSummaries: path.join(projectRoot, 'src', 'lib', 'openclaw', 'executionSummaries.js'),
	smartPolling: path.join(projectRoot, 'src', 'lib', 'openclaw', 'smartPolling.js')
};

const ensureControlledTempPath = (candidate) => {
	const tempRoot = path.resolve(os.tmpdir());
	const resolved = path.resolve(candidate);
	const relative = path.relative(tempRoot, resolved);
	if (
		!relative ||
		relative.startsWith('..') ||
		path.isAbsolute(relative) ||
		!path.basename(resolved).startsWith(TEMP_PREFIX)
	) {
		throw new Error('Refusing to manage a module E2E directory outside the OS temp directory');
	}
	return resolved;
};

const collectJavaScript = async (directory, root = directory, files = new Map()) => {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			await collectJavaScript(absolutePath, root, files);
			continue;
		}
		if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
		const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
		files.set(`/${relativePath}`, await readFile(absolutePath));
	}
	return files;
};

const buildBrowserModules = async (outputDirectory) => {
	await build({
		configFile: false,
		root: projectRoot,
		publicDir: false,
		appType: 'custom',
		clearScreen: false,
		logLevel: 'error',
		build: {
			copyPublicDir: false,
			emptyOutDir: false,
			minify: false,
			modulePreload: false,
			outDir: outputDirectory,
			sourcemap: false,
			target: 'es2022',
			rollupOptions: {
				input: moduleEntries,
				preserveEntrySignatures: 'strict',
				output: {
					assetFileNames: 'assets/[name]-[hash][extname]',
					chunkFileNames: 'chunks/[name]-[hash].js',
					entryFileNames: 'src/lib/openclaw/[name].js'
				}
			}
		}
	});

	const files = await collectJavaScript(outputDirectory);
	for (const name of Object.keys(moduleEntries)) {
		const route = `/src/lib/openclaw/${name}.js`;
		if (!files.has(route)) throw new Error(`Module E2E bundle is missing ${route}`);
	}
	return files;
};

const listen = (server, port) =>
	new Promise((resolve, reject) => {
		const handleError = (error) => {
			server.off('listening', handleListening);
			reject(error);
		};
		const handleListening = () => {
			server.off('error', handleError);
			resolve();
		};
		server.once('error', handleError);
		server.once('listening', handleListening);
		server.listen(port, HOST);
	});

const close = (server) =>
	new Promise((resolve) => {
		if (!server.listening) {
			resolve();
			return;
		}
		server.close(() => resolve());
	});

const port = parsePort();
const outputDirectory = ensureControlledTempPath(path.join(os.tmpdir(), `${TEMP_PREFIX}${port}`));
let browserModules = null;
let shuttingDown = false;

const server = createServer((request, response) => {
	const pathname = new URL(request.url || '/', `http://${HOST}`).pathname;
	response.setHeader('Cache-Control', 'no-store');
	response.setHeader('X-Content-Type-Options', 'nosniff');

	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.statusCode = 405;
		response.setHeader('Allow', 'GET, HEAD');
		response.end();
		return;
	}

	if (pathname === READY_PATH) {
		response.statusCode = browserModules ? 204 : 503;
		response.end();
		return;
	}

	if (pathname === HARNESS_PATH) {
		response.statusCode = browserModules ? 200 : 503;
		response.setHeader('Content-Type', 'text/html; charset=utf-8');
		response.end(request.method === 'HEAD' ? undefined : HARNESS_HTML);
		return;
	}

	const moduleSource = browserModules?.get(pathname);
	if (!moduleSource) {
		response.statusCode = browserModules ? 404 : 503;
		response.end();
		return;
	}

	response.statusCode = 200;
	response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
	response.end(request.method === 'HEAD' ? undefined : moduleSource);
});

const shutdown = async (exitCode = 0) => {
	if (shuttingDown) return;
	shuttingDown = true;
	await close(server);
	await rm(outputDirectory, { recursive: true, force: true });
	process.exitCode = exitCode;
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
	await listen(server, port);
	await rm(outputDirectory, { recursive: true, force: true });
	await mkdir(outputDirectory, { recursive: true });
	browserModules = await buildBrowserModules(outputDirectory);
	await rm(outputDirectory, { recursive: true, force: true });
	console.log(`OpenClaw module E2E server ready at http://${HOST}:${port}`);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	await shutdown(1);
}
