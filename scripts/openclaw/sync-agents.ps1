param(
    [string]$Profile = 'inoxpran'
)

$ErrorActionPreference = 'Stop'

$rootDir = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$agentsDir = Join-Path $rootDir 'deploy\openclaw\agents'
$workspacesDir = Join-Path $rootDir 'deploy\openclaw\workspaces'

if (-not (Get-Command openclaw -ErrorAction SilentlyContinue)) {
    Write-Host 'NOT RUN: openclaw command is unavailable.'
    exit 0
}

$openclawCmd = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
$openclawCommand = if ($openclawCmd) { $openclawCmd.Source } else { $null }
if (-not $openclawCommand) {
    $openclawCommand = (Get-Command openclaw -ErrorAction Stop).Source
}

function Invoke-OpenClaw {
    param(
        [string[]]$Arguments
    )

    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()

    try {
        $argumentList = ($Arguments | ForEach-Object {
            $argument = [string]$_
            if ($argument -match '[\s"]') {
                '"' + ($argument -replace '"', '\"') + '"'
            } else {
                $argument
            }
        }) -join ' '

        $process = Start-Process `
            -FilePath $openclawCommand `
            -ArgumentList $argumentList `
            -NoNewWindow `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        $stdout = Get-Content -Raw -ErrorAction SilentlyContinue $stdoutPath
        $stderr = Get-Content -Raw -ErrorAction SilentlyContinue $stderrPath
        $output = @($stdout, $stderr) -join [Environment]::NewLine
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Output = $output
        }
    } finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $stdoutPath, $stderrPath
    }
}

if (-not (Test-Path $agentsDir)) {
    throw "Missing OpenClaw agents directory: $agentsDir"
}

New-Item -ItemType Directory -Force -Path $workspacesDir | Out-Null

$listResult = Invoke-OpenClaw -Arguments @('--profile', $Profile, 'agents', 'list')
if ($listResult.ExitCode -ne 0) {
    Write-Host $listResult.Output
    throw "Unable to list OpenClaw agents for profile '$Profile'"
}

$listOutput = $listResult.Output
$existingAgents = @{}
foreach ($line in ($listOutput -split "`r?`n")) {
    if ($line -match '^\s*-\s+([A-Za-z0-9_.-]+)\b') {
        $existingAgents[$Matches[1]] = $true
    }
}

foreach ($agentFile in Get-ChildItem -Path $agentsDir -Filter '*.md' | Sort-Object Name) {
    $agentId = [System.IO.Path]::GetFileNameWithoutExtension($agentFile.Name)
    $workspace = Join-Path $workspacesDir $agentId
    New-Item -ItemType Directory -Force -Path $workspace | Out-Null

    $agentInstructions = Get-Content -Raw -Path $agentFile.FullName
    $bootstrapPath = Join-Path $workspace 'BOOTSTRAP.md'
    $agentsPath = Join-Path $workspace 'AGENTS.md'
    $identityPath = Join-Path $workspace 'IDENTITY.md'
    $userPath = Join-Path $workspace 'USER.md'

    @(
        "# $agentId",
        '',
        'This workspace is managed by scripts/openclaw/sync-agents.ps1.',
        'Follow AGENTS.md for role, constraints, and handoff rules.',
        '',
        'Project: Inoxpran SEO automation.',
        'Default output: create draft-only blog workflow artifacts unless explicitly instructed by the reviewer/publisher policy.'
    ) | Set-Content -Path $bootstrapPath -Encoding UTF8

    @(
        "# $agentId",
        '',
        $agentInstructions
    ) | Set-Content -Path $agentsPath -Encoding UTF8

    @(
        '# IDENTITY.md',
        '',
        "- **Name:** $agentId",
        '- **Vibe:** focused SEO operations agent',
        '- **Emoji:**',
        '- **Avatar:**'
    ) | Set-Content -Path $identityPath -Encoding UTF8

    @(
        '# USER.md',
        '',
        'The user owns the Inoxpran website and wants a conservative daily SEO blog automation workflow.',
        'Never expose credentials. Never publish directly unless backend safety gates and reviewer conditions pass.'
    ) | Set-Content -Path $userPath -Encoding UTF8

    if ($existingAgents.ContainsKey($agentId)) {
        Write-Host "Agent already registered: $agentId"
        continue
    }

    Write-Host "Registering OpenClaw agent: $agentId"
    $addResult = Invoke-OpenClaw -Arguments @('--profile', $Profile, 'agents', 'add', '--workspace', $workspace, '--non-interactive', $agentId)
    Write-Host $addResult.Output
    if ($addResult.ExitCode -ne 0 -and $addResult.Output -notmatch 'already') {
        throw "Unable to register OpenClaw agent: $agentId"
    }
}

Write-Host "OpenClaw agent sync complete for profile '$Profile'."
