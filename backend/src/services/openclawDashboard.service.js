'use strict'

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { BadRequestError, NotFoundError } = require('../core/error.response');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const OPENCLAW_ROOT = path.join(REPO_ROOT, 'deploy', 'openclaw');
const REPORT_FILE = path.join(OPENCLAW_ROOT, 'SKILL_INSTALL_REPORT.md');
const SCRIPT_ROOT = path.join(REPO_ROOT, 'scripts', 'openclaw');
const DEFAULT_PROFILE = process.env.OPENCLAW_PROFILE || 'inoxpran';
const MAX_RUNS = 30;
const MAX_LOG_CHARS = 18000;

const runStore = new Map();
let lastDashboardUrl = process.env.OPENCLAW_DASHBOARD_URL || 'http://127.0.0.1:18789/';

const ACTIONS = {
    'start-openclaw': {
        label: 'Start OpenClaw gateway',
        timeoutMs: 90 * 1000
    },
    'stop-openclaw': {
        label: 'Stop OpenClaw gateway',
        timeoutMs: 90 * 1000
    },
    status: {
        label: 'Refresh OpenClaw status',
        timeoutMs: 60 * 1000
    },
    'install-skills': {
        label: 'Install verified ClawHub skills',
        timeoutMs: 15 * 60 * 1000
    },
    'sync-agents': {
        label: 'Sync OpenClaw agents',
        timeoutMs: 10 * 60 * 1000
    },
    'smoke-test': {
        label: 'Create smoke-test draft',
        timeoutMs: 90 * 1000
    },
    'daily-draft': {
        label: 'Run daily draft workflow',
        timeoutMs: 35 * 60 * 1000
    }
};

const readFileIfExists = (filePath) => {
    try {
        if (!fs.existsSync(filePath)) return '';
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return '';
    }
};

const listMarkdownNames = (directory) => {
    try {
        if (!fs.existsSync(directory)) return [];
        return fs.readdirSync(directory)
            .filter((name) => name.endsWith('.md'))
            .map((name) => name.replace(/\.md$/i, ''))
            .sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
};

const listDirectoryNames = (directory) => {
    try {
        if (!fs.existsSync(directory)) return [];
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
};

const parseBoolean = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const redactForDashboard = (value) => {
    let output = String(value || '');
    output = output.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted-openai-key]');
    output = output.replace(/mongodb(\+srv)?:\/\/[^\s"']+/gi, '[redacted-mongodb-uri]');
    output = output.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
    output = output.replace(/([?&](?:token|auth|access_token)=)[^&\s"']+/gi, '$1[redacted]');
    output = output.replace(
        /\b(API_KEY|SEO_AGENT_API_KEY|SEO_AGENT_HMAC_SECRET|OPENCLAW_GATEWAY_TOKEN|OPENAI_API_KEY|MONGODB_URI)(\s*[:=]\s*)([^\s"']+)/gi,
        '$1$2[redacted]'
    );
    output = output.replace(
        /\b(x-api-key|x-seo-agent-key|x-openclaw-signature|authorization)(\s*:\s*)([^\s"']+)/gi,
        '$1$2[redacted]'
    );
    return output.length > MAX_LOG_CHARS ? `${output.slice(-MAX_LOG_CHARS)}\n[log truncated]` : output;
};

const extractDashboardUrl = (value) => {
    const output = String(value || '');
    const explicitMatch = output.match(/OPENCLAW_DASHBOARD_URL=(https?:\/\/127\.0\.0\.1:\d+\/[^\s"'<>]*)/i);
    if (explicitMatch) return explicitMatch[1];

    const urls = Array.from(output.matchAll(/https?:\/\/127\.0\.0\.1:\d+\/[^\s"'<>]*/gi)).map((match) => match[0]);
    return urls.find((url) => /[?&](token|auth|access_token)=/i.test(url)) || urls[0] || '';
};

const normalizeProfile = (profile) => {
    const activeProfile = String(profile || DEFAULT_PROFILE || '').trim() || 'inoxpran';
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(activeProfile)) {
        throw new BadRequestError('Invalid OpenClaw profile');
    }
    return activeProfile;
};

const powerShellOpenClawCommand = (openclawArgs, { captureDashboardClipboard = false } = {}) => {
    const quotedArgs = openclawArgs
        .map((arg) => `'${String(arg).replace(/'/g, "''")}'`)
        .join(', ');
    const clipboardScript = captureDashboardClipboard
        ? `
$exitCode = $LASTEXITCODE
try {
    $dashboardClipboard = Get-Clipboard -Raw -ErrorAction Stop
    if ($dashboardClipboard -match '^https?://127\\.0\\.0\\.1:\\d+/') {
        Write-Output "OPENCLAW_DASHBOARD_URL=$dashboardClipboard"
    }
} catch {}
exit $exitCode`
        : '';

    return {
        executable: 'powershell.exe',
        args: [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `$openclawArgs = @(${quotedArgs}); & openclaw @openclawArgs${clipboardScript}`
        ]
    };
};

const parseSkillReport = () => {
    const report = readFileIfExists(REPORT_FILE);
    const installed = [];
    const alreadyInstalled = [];
    const skipped = [];
    const notInstalled = [];

    for (const line of report.split(/\r?\n/)) {
        const installedMatch = line.match(/^INSTALLED:\s*(.+)$/);
        if (installedMatch) installed.push(installedMatch[1].trim());

        const alreadyInstalledMatch = line.match(/^ALREADY INSTALLED:\s*(.+)$/);
        if (alreadyInstalledMatch) {
            const skill = alreadyInstalledMatch[1].trim();
            alreadyInstalled.push(skill);
            installed.push(skill);
        }

        const skipMatch = line.match(/^SKIP:\s*(.+)$/);
        if (skipMatch) skipped.push(skipMatch[1].trim());

        const notInstalledMatch = line.match(/^- `([^`]+)`:\s*(.+)$/);
        if (notInstalledMatch) {
            notInstalled.push({
                skill: notInstalledMatch[1],
                reason: notInstalledMatch[2]
            });
        }
    }

    return {
        path: path.relative(REPO_ROOT, REPORT_FILE),
        exists: Boolean(report),
        installed: Array.from(new Set(installed)),
        alreadyInstalled,
        skipped,
        notInstalled,
        preview: redactForDashboard(report).slice(0, 8000)
    };
};

const getScriptPath = (baseName) => {
    if (process.platform === 'win32') {
        const ps1Path = path.join(SCRIPT_ROOT, `${baseName}.ps1`);
        if (fs.existsSync(ps1Path)) return ps1Path;
    }
    return path.join(SCRIPT_ROOT, `${baseName}.sh`);
};

const buildCommand = ({ action, profile }) => {
    const activeProfile = normalizeProfile(profile);

    if (action === 'status' || action === 'start-openclaw' || action === 'stop-openclaw') {
        const gatewayActionByDashboardAction = {
            'start-openclaw': ['dashboard', '--yes', '--no-open'],
            'stop-openclaw': ['gateway', 'stop']
        };
        const openclawArgs = gatewayActionByDashboardAction[action] || ['status'];
        const args = ['--profile', activeProfile, ...openclawArgs];

        if (process.platform === 'win32') {
            return {
                ...powerShellOpenClawCommand(args, {
                    captureDashboardClipboard: action === 'start-openclaw'
                }),
                display: `openclaw --profile ${activeProfile} ${openclawArgs.join(' ')}`
            };
        }

        return {
            executable: 'openclaw',
            args,
            display: `openclaw --profile ${activeProfile} ${openclawArgs.join(' ')}`
        };
    }

    const scriptByAction = {
        'install-skills': 'install-skills',
        'sync-agents': 'sync-agents',
        'smoke-test': 'smoke-test-publish',
        'daily-draft': 'run-daily-draft'
    };
    const script = getScriptPath(scriptByAction[action]);
    if (!fs.existsSync(script)) {
        throw new BadRequestError(`Missing script for action: ${action}`);
    }

    if (process.platform === 'win32') {
        const args = ['-ExecutionPolicy', 'Bypass', '-File', script];
        if (action === 'install-skills' || action === 'sync-agents' || action === 'daily-draft') {
            args.push('-Profile', activeProfile);
        }
        return {
            executable: 'powershell.exe',
            args,
            display: `powershell -ExecutionPolicy Bypass -File ${path.relative(REPO_ROOT, script)}`
        };
    }

    return {
        executable: 'bash',
        args: [script],
        display: `bash ${path.relative(REPO_ROOT, script)}`
    };
};

const normalizeRun = (run) => ({
    id: run.id,
    action: run.action,
    label: ACTIONS[run.action]?.label || run.action,
    status: run.status,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    command: run.command,
    durationMs: run.finishedAt ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() : null,
    dashboardUrl: run.dashboardUrl || '',
    output: redactForDashboard(run.output),
    error: run.error ? redactForDashboard(run.error) : ''
});

const trimRunStore = () => {
    const runs = Array.from(runStore.values()).sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    runs.slice(MAX_RUNS).forEach((run) => runStore.delete(run.id));
};

const getRecentRuns = () =>
    Array.from(runStore.values())
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .map(normalizeRun);

const buildDashboard = () => {
    const localAgents = listMarkdownNames(path.join(OPENCLAW_ROOT, 'agents'));
    const localSkills = listDirectoryNames(path.join(OPENCLAW_ROOT, 'skills'));
    const skillReport = parseSkillReport();
    const requiredEnv = [
        'API_KEY',
        'SEO_AGENT_API_KEY',
        'SEO_AGENT_HMAC_SECRET',
        'OPENCLAW_GATEWAY_TOKEN',
        'FIRECRAWL_API_KEY'
    ];

    return {
        profile: DEFAULT_PROFILE,
        platform: {
            os: os.platform(),
            node: process.version,
            repoRoot: REPO_ROOT
        },
        automation: {
            enabled: parseBoolean(process.env.SEO_AGENT_ENABLED),
            autoPublish: parseBoolean(process.env.SEO_AGENT_AUTO_PUBLISH),
            minSeoScore: Number(process.env.SEO_AGENT_MIN_SEO_SCORE || 85),
            minWords: Number(process.env.SEO_AGENT_MIN_WORDS || 800),
            maxWords: Number(process.env.SEO_AGENT_MAX_WORDS || 1800),
            defaultImage: process.env.SEO_AGENT_DEFAULT_BLOG_IMAGE || '/images/og-image.png'
        },
        env: Object.fromEntries(requiredEnv.map((name) => [name, Boolean(process.env[name])])),
        openclaw: {
            dashboardUrl: lastDashboardUrl,
            gatewayUrl: 'ws://127.0.0.1:18789',
            configPath: path.relative(REPO_ROOT, path.join(OPENCLAW_ROOT, 'openclaw.json5')),
            promptPath: path.relative(REPO_ROOT, path.join(OPENCLAW_ROOT, 'prompts', 'daily-seo-blog.md')),
            configExists: fs.existsSync(path.join(OPENCLAW_ROOT, 'openclaw.json5')),
            promptExists: fs.existsSync(path.join(OPENCLAW_ROOT, 'prompts', 'daily-seo-blog.md'))
        },
        actions: Object.entries(ACTIONS).map(([id, action]) => ({
            id,
            label: action.label,
            timeoutMs: action.timeoutMs
        })),
        agents: localAgents,
        localSkills,
        skillReport,
        runs: getRecentRuns()
    };
};

class OpenClawDashboardService {
    static dashboard() {
        return buildDashboard();
    }

    static listRuns() {
        return { runs: getRecentRuns() };
    }

    static getRun({ runId }) {
        const run = runStore.get(String(runId || ''));
        if (!run) throw new NotFoundError('OpenClaw run not found');
        return normalizeRun(run);
    }

    static startRun({ action, profile }) {
        const normalizedAction = String(action || '').trim();
        if (!ACTIONS[normalizedAction]) {
            throw new BadRequestError('Unsupported OpenClaw action');
        }

        const command = buildCommand({ action: normalizedAction, profile });
        const run = {
            id: randomUUID(),
            action: normalizedAction,
            status: 'running',
            exitCode: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            command: command.display,
            rawOutput: '',
            dashboardUrl: '',
            output: '',
            error: ''
        };
        runStore.set(run.id, run);
        trimRunStore();

        let child;
        try {
            child = spawn(command.executable, command.args, {
                cwd: REPO_ROOT,
                env: {
                    ...process.env,
                    OPENCLAW_PROFILE: normalizeProfile(profile)
                },
                windowsHide: true
            });
        } catch (error) {
            run.status = 'failed';
            run.error = redactForDashboard(error.message);
            run.finishedAt = new Date().toISOString();
            return normalizeRun(run);
        }

        const appendOutput = (chunk) => {
            run.rawOutput = `${run.rawOutput}${chunk.toString()}`;
            run.output = redactForDashboard(run.rawOutput);
        };

        child.stdout.on('data', appendOutput);
        child.stderr.on('data', appendOutput);
        child.on('error', (error) => {
            run.status = 'failed';
            run.error = redactForDashboard(error.message);
            run.finishedAt = new Date().toISOString();
        });
        child.on('close', (code) => {
            if (run.status === 'failed') return;
            run.exitCode = code;
            run.status = code === 0 ? 'completed' : 'failed';
            run.finishedAt = new Date().toISOString();
            if (normalizedAction === 'start-openclaw') {
                const dashboardUrl = extractDashboardUrl(run.rawOutput);
                if (dashboardUrl) {
                    run.dashboardUrl = dashboardUrl;
                    lastDashboardUrl = dashboardUrl;
                }
            }
            if (normalizedAction === 'install-skills') {
                run.output = redactForDashboard(`${run.output}\n\n${readFileIfExists(REPORT_FILE)}`);
            }
        });

        const timeout = setTimeout(() => {
            if (run.status !== 'running') return;
            run.status = 'timed_out';
            run.error = `Timed out after ${ACTIONS[normalizedAction].timeoutMs}ms`;
            run.finishedAt = new Date().toISOString();
            child.kill('SIGTERM');
        }, ACTIONS[normalizedAction].timeoutMs);
        timeout.unref?.();

        child.on('close', () => clearTimeout(timeout));

        return normalizeRun(run);
    }
}

module.exports = {
    OpenClawDashboardService,
    extractDashboardUrl,
    redactForDashboard
};
