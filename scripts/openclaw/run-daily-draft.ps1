param(
    [string]$Profile = 'inoxpran',
    [string]$SessionKey = 'agent:seo-orchestrator:daily-manual-test',
    [int]$TimeoutSeconds = 1800
)

$ErrorActionPreference = 'Stop'

$rootDir = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$promptFile = Join-Path $rootDir 'deploy\openclaw\prompts\daily-seo-blog.md'

if (-not (Get-Command openclaw -ErrorAction SilentlyContinue)) {
    Write-Host 'NOT RUN: openclaw command is unavailable.'
    exit 0
}

if (-not (Test-Path $promptFile)) {
    throw "Missing prompt file: $promptFile"
}

# The backend environment still decides final publish/draft behavior.
# Keep the OpenClaw-side flag conservative for manual tests.
$env:INOXPRAN_SEO_AGENT_AUTO_PUBLISH = 'false'

$args = @()
if ($Profile) {
    $args += @('--profile', $Profile)
}

$args += @(
    'agent',
    '--agent', 'seo-orchestrator',
    '--session-key', $SessionKey,
    '--message-file', $promptFile,
    '--timeout', [string]$TimeoutSeconds
)

Write-Host "Running OpenClaw daily draft workflow with profile '$Profile'..."
& openclaw @args
