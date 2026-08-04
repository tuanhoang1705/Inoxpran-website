import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    PATCH_ID,
    OpenClawPatchError,
    buildPatchedSource,
    patchOpenClawProviderModel,
    sha256
} from '../../deploy/openclaw/patches/patch-openresponses-provider-model.mjs';

const temporaryRoots = [];

const ORIGINAL_FIXTURE = [
    'function extractUsageFromResult(result) {',
    '\tconst meta = result?.meta;',
    '\treturn toUsage(meta && typeof meta === "object" ? meta.agentMeta?.usage : void 0);',
    '}',
    'function resolveStopReasonAndPendingToolCalls(meta) {',
    '\treturn meta;',
    '}',
    'function createResponseResource(params) {',
    '\treturn {',
    '\t\tstatus: params.status,',
    '\t\tmodel: params.model,',
    '\t\toutput: params.output,',
    '\t\tusage: params.usage',
    '\t};',
    '}',
    'async function nonStream(result) {',
    '\t\t\tconst usage = extractUsageFromResult(result);',
    '\t\t\tconst meta = result?.meta;',
    '\t\t\tconst response = createResponseResource({',
    '\t\t\t\tid: responseId,',
    '\t\t\t\tmodel,',
    '\t\t\t\tstatus: "completed",',
    '\t\t\t\toutput: [],',
    '\t\t\t\tusage',
    '\t\t\t});',
    '\treturn { response, meta };',
    '}'
].join('\n');

const fixtureManifest = (source = ORIGINAL_FIXTURE, overrides = {}) => {
    const patched = buildPatchedSource(source);
    return {
        packageName: 'openclaw',
        version: '2026.6.11',
        targetRelativePath: 'dist/openresponses-http-B4XywqAb.js',
        originalSha256: sha256(source),
        patchedSha256: sha256(patched),
        ...overrides
    };
};

const createFixture = async ({ source = ORIGINAL_FIXTURE, version = '2026.6.11' } = {}) => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), 'inoxpran-openclaw-patch-'));
    temporaryRoots.push(packageRoot);
    await mkdir(path.join(packageRoot, 'dist'));
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'openclaw', version }));
    const targetPath = path.join(packageRoot, 'dist', 'openresponses-http-B4XywqAb.js');
    await writeFile(targetPath, source);
    return { packageRoot, targetPath };
};

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('OpenClaw provider-model patcher', () => {
    it('defaults to a non-mutating dry run against an exact version/hash/anchor fixture', async () => {
        const fixture = await createFixture();
        const result = await patchOpenClawProviderModel({
            packageRoot: fixture.packageRoot,
            manifest: fixtureManifest()
        });

        expect(result).toMatchObject({
            patchId: PATCH_ID,
            version: '2026.6.11',
            state: 'unpatched',
            mode: 'dry-run',
            changed: false
        });
        expect(await readFile(fixture.targetPath, 'utf8')).toBe(ORIGINAL_FIXTURE);
    });

    it('applies once, exposes canonical provider/model metadata, and is idempotent', async () => {
        const fixture = await createFixture();
        const manifest = fixtureManifest();
        const first = await patchOpenClawProviderModel({
            packageRoot: fixture.packageRoot,
            mode: 'apply',
            manifest
        });
        const patched = await readFile(fixture.targetPath, 'utf8');

        expect(first).toMatchObject({ state: 'patched', changed: true, sha256: manifest.patchedSha256 });
        expect(patched).toContain(`// ${PATCH_ID}`);
        expect(patched).toContain('const provider = typeof agentMeta.provider === "string"');
        expect(patched).toContain('provider + "/" + model');
        expect(patched).toContain('provider_model: params.providerModel');
        expect(patched).toContain('providerModel = extractProviderModelFromResult(result)');
        expect(await readFile(`${fixture.targetPath}.${PATCH_ID}.bak`, 'utf8')).toBe(ORIGINAL_FIXTURE);

        await expect(patchOpenClawProviderModel({
            packageRoot: fixture.packageRoot,
            mode: 'apply',
            manifest
        })).resolves.toMatchObject({ state: 'patched', changed: false });
        await expect(patchOpenClawProviderModel({
            packageRoot: fixture.packageRoot,
            mode: 'verify-patched',
            manifest
        })).resolves.toMatchObject({ state: 'patched', changed: false });
    });

    it('fails verification when the exact vendor source is still unpatched', async () => {
        const fixture = await createFixture();
        await expect(patchOpenClawProviderModel({
            packageRoot: fixture.packageRoot,
            mode: 'verify-patched',
            manifest: fixtureManifest()
        })).rejects.toMatchObject({ code: 'OPENCLAW_PROVIDER_MODEL_PATCH_REQUIRED' });
    });

    it('rejects version drift, source hash drift, and anchor drift before writing', async () => {
        const wrongVersion = await createFixture({ version: '2026.6.12' });
        await expect(patchOpenClawProviderModel({
            packageRoot: wrongVersion.packageRoot,
            mode: 'apply',
            manifest: fixtureManifest()
        })).rejects.toMatchObject({ code: 'OPENCLAW_PATCH_VERSION_MISMATCH' });

        const hashDrift = await createFixture({ source: `${ORIGINAL_FIXTURE}\n// vendor drift` });
        await expect(patchOpenClawProviderModel({
            packageRoot: hashDrift.packageRoot,
            mode: 'apply',
            manifest: fixtureManifest()
        })).rejects.toMatchObject({ code: 'OPENCLAW_PATCH_SOURCE_HASH_MISMATCH' });

        const anchorDriftSource = ORIGINAL_FIXTURE.replace('status: "completed"', 'status: "done"');
        const anchorDrift = await createFixture({ source: anchorDriftSource });
        const anchorManifest = {
            ...fixtureManifest(),
            originalSha256: sha256(anchorDriftSource)
        };
        await expect(patchOpenClawProviderModel({
            packageRoot: anchorDrift.packageRoot,
            mode: 'apply',
            manifest: anchorManifest
        })).rejects.toMatchObject({ code: 'OPENCLAW_PATCH_ANCHOR_MISMATCH' });

        expect(await readFile(wrongVersion.targetPath, 'utf8')).toBe(ORIGINAL_FIXTURE);
        expect(await readFile(hashDrift.targetPath, 'utf8')).toContain('vendor drift');
        expect(await readFile(anchorDrift.targetPath, 'utf8')).toBe(anchorDriftSource);
    });

    it('returns stable error codes without embedding package paths or source content', async () => {
        const fixture = await createFixture({ version: 'unexpected' });
        let failure;
        try {
            await patchOpenClawProviderModel({
                packageRoot: fixture.packageRoot,
                mode: 'apply',
                manifest: fixtureManifest()
            });
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(OpenClawPatchError);
        expect(failure.code).toBe('OPENCLAW_PATCH_VERSION_MISMATCH');
        expect(failure.message).not.toContain(fixture.packageRoot);
        expect(failure.message).not.toContain(ORIGINAL_FIXTURE);
    });
});
