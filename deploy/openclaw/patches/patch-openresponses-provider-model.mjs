#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PATCH_ID = 'inoxpran-openresponses-provider-model-v1';

const PATCH_MANIFEST = Object.freeze({
  packageName: 'openclaw',
  version: '2026.6.11',
  targetRelativePath: 'dist/openresponses-http-B4XywqAb.js',
  originalSha256: 'ba2b1ce0536c2c911dc7414bcc77dbe893e8a2b93098b14291e8d478e3257f40',
  // Filled from the deterministic anchored transform below. Any other vendor
  // build or previously modified source is rejected before a write occurs.
  patchedSha256: '7df9dcb3108652e09f2b2c7a2b660a4cf319e8d5de2c89b853b5f1d78e4cd2c6'
});

class OpenClawPatchError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'OpenClawPatchError';
    this.code = code;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const countOccurrences = (source, needle) => {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
};

const REPLACEMENTS = Object.freeze([
  Object.freeze({
    name: 'provider-model-extractor',
    from: [
      'function extractUsageFromResult(result) {',
      '\tconst meta = result?.meta;',
      '\treturn toUsage(meta && typeof meta === "object" ? meta.agentMeta?.usage : void 0);',
      '}',
      'function resolveStopReasonAndPendingToolCalls(meta) {'
    ].join('\n'),
    to: [
      'function extractUsageFromResult(result) {',
      '\tconst meta = result?.meta;',
      '\treturn toUsage(meta && typeof meta === "object" ? meta.agentMeta?.usage : void 0);',
      '}',
      `// ${PATCH_ID}`,
      'function extractProviderModelFromResult(result) {',
      '\tconst agentMeta = result?.meta?.agentMeta;',
      '\tif (!agentMeta || typeof agentMeta !== "object") return void 0;',
      '\tconst provider = typeof agentMeta.provider === "string" ? agentMeta.provider.trim() : "";',
      '\tconst model = typeof agentMeta.model === "string" ? agentMeta.model.trim() : "";',
      '\tif (!model) return void 0;',
      '\treturn provider && !model.startsWith(provider + "/") ? provider + "/" + model : model;',
      '}',
      'function resolveStopReasonAndPendingToolCalls(meta) {'
    ].join('\n')
  }),
  Object.freeze({
    name: 'response-envelope-field',
    from: [
      '\t\tstatus: params.status,',
      '\t\tmodel: params.model,',
      '\t\toutput: params.output,'
    ].join('\n'),
    to: [
      '\t\tstatus: params.status,',
      '\t\tmodel: params.model,',
      '\t\tprovider_model: params.providerModel,',
      '\t\toutput: params.output,'
    ].join('\n')
  }),
  Object.freeze({
    name: 'non-stream-provider-model',
    from: [
      '\t\t\tconst usage = extractUsageFromResult(result);',
      '\t\t\tconst meta = result?.meta;'
    ].join('\n'),
    to: [
      '\t\t\tconst usage = extractUsageFromResult(result);',
      '\t\t\tconst providerModel = extractProviderModelFromResult(result);',
      '\t\t\tconst meta = result?.meta;'
    ].join('\n')
  }),
  Object.freeze({
    name: 'completed-envelope',
    from: [
      '\t\t\tconst response = createResponseResource({',
      '\t\t\t\tid: responseId,',
      '\t\t\t\tmodel,',
      '\t\t\t\tstatus: "completed",'
    ].join('\n'),
    to: [
      '\t\t\tconst response = createResponseResource({',
      '\t\t\t\tid: responseId,',
      '\t\t\t\tmodel,',
      '\t\t\t\tproviderModel,',
      '\t\t\t\tstatus: "completed",'
    ].join('\n')
  })
]);

const assertPatchedAnchors = (source) => {
  const required = [
    `// ${PATCH_ID}`,
    'function extractProviderModelFromResult(result) {',
    '\t\tprovider_model: params.providerModel,',
    '\t\t\tconst providerModel = extractProviderModelFromResult(result);'
  ];
  for (const anchor of required) {
    if (countOccurrences(source, anchor) !== 1) {
      throw new OpenClawPatchError(
        'OPENCLAW_PATCHED_ANCHOR_INVALID',
        `Patched anchor count is invalid for ${JSON.stringify(anchor)}`
      );
    }
  }
};

const buildPatchedSource = (source) => {
  let patched = source;
  for (const replacement of REPLACEMENTS) {
    const count = countOccurrences(patched, replacement.from);
    if (count !== 1) {
      throw new OpenClawPatchError(
        'OPENCLAW_PATCH_ANCHOR_MISMATCH',
        `Expected exactly one ${replacement.name} anchor; found ${count}`
      );
    }
    patched = patched.replace(replacement.from, replacement.to);
  }
  assertPatchedAnchors(patched);
  return patched;
};

const resolveTarget = (packageRoot, manifest) => {
  const root = path.resolve(String(packageRoot || ''));
  if (!packageRoot || root === path.parse(root).root) {
    throw new OpenClawPatchError('OPENCLAW_PATCH_PACKAGE_ROOT_INVALID');
  }
  const targetPath = path.resolve(root, manifest.targetRelativePath);
  const relative = path.relative(root, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new OpenClawPatchError('OPENCLAW_PATCH_TARGET_PATH_UNSAFE');
  }
  return { root, targetPath };
};

const inspectOpenClawPatch = async ({ packageRoot, manifest = PATCH_MANIFEST } = {}) => {
  const { root, targetPath } = resolveTarget(packageRoot, manifest);
  const packageJsonPath = path.join(root, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  } catch {
    throw new OpenClawPatchError('OPENCLAW_PATCH_PACKAGE_JSON_INVALID');
  }
  if (packageJson?.name !== manifest.packageName || packageJson?.version !== manifest.version) {
    throw new OpenClawPatchError('OPENCLAW_PATCH_VERSION_MISMATCH');
  }

  let source;
  try {
    source = await readFile(targetPath, 'utf8');
  } catch {
    throw new OpenClawPatchError('OPENCLAW_PATCH_TARGET_UNREADABLE');
  }
  const sourceSha256 = sha256(source);
  if (sourceSha256 === manifest.patchedSha256) {
    assertPatchedAnchors(source);
    return { state: 'patched', root, targetPath, source, sourceSha256 };
  }
  if (sourceSha256 !== manifest.originalSha256) {
    throw new OpenClawPatchError('OPENCLAW_PATCH_SOURCE_HASH_MISMATCH');
  }
  const patchedSource = buildPatchedSource(source);
  const patchedSha256 = sha256(patchedSource);
  if (patchedSha256 !== manifest.patchedSha256) {
    throw new OpenClawPatchError('OPENCLAW_PATCH_OUTPUT_HASH_MISMATCH');
  }
  return {
    state: 'unpatched',
    root,
    targetPath,
    source,
    sourceSha256,
    patchedSource,
    patchedSha256
  };
};

const patchOpenClawProviderModel = async ({
  packageRoot,
  mode = 'dry-run',
  manifest = PATCH_MANIFEST
} = {}) => {
  if (!['dry-run', 'apply', 'verify-patched'].includes(mode)) {
    throw new OpenClawPatchError('OPENCLAW_PATCH_MODE_INVALID');
  }
  const inspection = await inspectOpenClawPatch({ packageRoot, manifest });
  if (mode === 'verify-patched' && inspection.state !== 'patched') {
    throw new OpenClawPatchError('OPENCLAW_PROVIDER_MODEL_PATCH_REQUIRED');
  }
  if (mode !== 'apply' || inspection.state === 'patched') {
    return Object.freeze({
      patchId: PATCH_ID,
      version: manifest.version,
      state: inspection.state,
      mode,
      changed: false,
      sha256: inspection.sourceSha256
    });
  }

  const fileStat = await stat(inspection.targetPath);
  const backupPath = `${inspection.targetPath}.${PATCH_ID}.bak`;
  try {
    await access(backupPath, fsConstants.F_OK);
    throw new OpenClawPatchError('OPENCLAW_PATCH_BACKUP_ALREADY_EXISTS');
  } catch (error) {
    if (error instanceof OpenClawPatchError) throw error;
  }
  await copyFile(inspection.targetPath, backupPath, fsConstants.COPYFILE_EXCL);
  try {
    await writeFile(inspection.targetPath, inspection.patchedSource, { mode: fileStat.mode });
    const verified = await inspectOpenClawPatch({ packageRoot, manifest });
    if (verified.state !== 'patched') {
      throw new OpenClawPatchError('OPENCLAW_PATCH_POST_WRITE_VERIFICATION_FAILED');
    }
  } catch (error) {
    await copyFile(backupPath, inspection.targetPath);
    throw error;
  }
  return Object.freeze({
    patchId: PATCH_ID,
    version: manifest.version,
    state: 'patched',
    mode,
    changed: true,
    sha256: manifest.patchedSha256,
    backupPath
  });
};

const parseCli = (argv) => {
  let mode = 'dry-run';
  let packageRoot = '';
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') mode = 'dry-run';
    else if (value === '--apply') mode = 'apply';
    else if (value === '--verify-patched') mode = 'verify-patched';
    else if (value === '--package-root') packageRoot = argv[++index] || '';
    else throw new OpenClawPatchError('OPENCLAW_PATCH_ARGUMENT_INVALID');
  }
  if (!packageRoot) throw new OpenClawPatchError('OPENCLAW_PATCH_PACKAGE_ROOT_REQUIRED');
  return { mode, packageRoot };
};

const runCli = async () => {
  try {
    const result = await patchOpenClawProviderModel(parseCli(process.argv.slice(2)));
    const safeResult = {
      patchId: result.patchId,
      version: result.version,
      state: result.state,
      mode: result.mode,
      changed: result.changed,
      sha256: result.sha256
    };
    process.stdout.write(`${JSON.stringify(safeResult)}\n`);
  } catch (error) {
    const code = error instanceof OpenClawPatchError
      ? error.code
      : 'OPENCLAW_PATCH_UNEXPECTED_FAILURE';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) await runCli();

export {
  PATCH_ID,
  PATCH_MANIFEST,
  REPLACEMENTS,
  OpenClawPatchError,
  assertPatchedAnchors,
  buildPatchedSource,
  inspectOpenClawPatch,
  patchOpenClawProviderModel,
  sha256
};
