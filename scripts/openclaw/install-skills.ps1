param(
    [switch]$VerifyOnly,
    [switch]$Force,
    [string]$Profile = 'inoxpran'
)

$ErrorActionPreference = 'Stop'

$rootDir = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$reportFile = Join-Path $rootDir 'deploy\openclaw\SKILL_INSTALL_REPORT.md'

$skills = @(
    'skill-vetter',
    'ddg-web-search',
    'firecrawl-api',
    'market-research',
    'deep-research-agent',
    'content-generation',
    'image-generation'
)

$reportDir = Split-Path -Parent $reportFile
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

@(
    '# ClawHub Skill Install Report',
    '',
    "Generated: $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
    '',
    'Procedure: inspect each slug, verify it, then install only verified skills.',
    '',
    "VerifyOnly: $VerifyOnly",
    "Force: $Force",
    "Profile: $Profile",
    '',
    '## Core skills',
    ''
) | Set-Content -Path $reportFile -Encoding UTF8

foreach ($skill in $skills) {
    Add-Content -Path $reportFile -Encoding UTF8 -Value "- ``$skill``"
}

@(
    '',
    '## Not installed automatically',
    '',
    '- `keyword-research`: verify failed because security/card was pending.',
    '- `serp-analysis`: verify failed because security/card was pending.',
    '- `content-gap-analysis`: verify failed because security/card was pending.',
    '- `openclaw-seo-content-engine`: verify failed; scanner flagged live Chrome and hard-coded local API-key path.',
    '- `blog-writing`: verify failed; scanner flagged shell/full-security subagent requests.',
    '- `citedy-seo-agent`: verify failed; scanner flagged broad credit spending, public publishing, deletes, and recurring automation.',
    '- `multi-search-engine`: verify failed; scanner flagged third-party query/privacy risk.',
    '- `skillscan`: verify failed; scanner flagged upload/telemetry/self-update behavior.',
    '- `nano-banana-pro`: slug is ambiguous across multiple owners; choose and vet one manually before use.',
    ''
) | Add-Content -Path $reportFile -Encoding UTF8

$missingCommands = @()
foreach ($commandName in @('clawhub', 'openclaw')) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        $missingCommands += $commandName
    }
}

if ($missingCommands.Count -gt 0) {
    @(
        '## Result',
        '',
        "NOT RUN: required command(s) unavailable: $($missingCommands -join ', ')",
        '',
        'Run this script on the VPS after installing OpenClaw and ClawHub CLI.'
    ) | Add-Content -Path $reportFile -Encoding UTF8
    Write-Host "OpenClaw skill installation not run; missing command(s): $($missingCommands -join ', ')"
    Write-Host "Report written to $reportFile"
    exit 0
}

$clawhubCmd = Get-Command clawhub.cmd -ErrorAction SilentlyContinue
$clawhubCommand = if ($clawhubCmd) { $clawhubCmd.Source } else { $null }
if (-not $clawhubCommand) {
    $clawhubCommand = (Get-Command clawhub -ErrorAction Stop).Source
}

$openclawCmd = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
$openclawCommand = if ($openclawCmd) { $openclawCmd.Source } else { $null }
if (-not $openclawCommand) {
    $openclawCommand = (Get-Command openclaw -ErrorAction Stop).Source
}

$openclawPrefix = @()
if ($Profile) {
    $openclawPrefix = @('--profile', $Profile)
}

function Invoke-ExternalToFile {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$OutputPath
    )

    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()

    try {
        $process = Start-Process `
            -FilePath $FilePath `
            -ArgumentList $Arguments `
            -NoNewWindow `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        Get-Content -ErrorAction SilentlyContinue $stdoutPath, $stderrPath |
            Set-Content -Path $OutputPath -Encoding UTF8

        return $process.ExitCode
    } finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $stdoutPath, $stderrPath
    }
}

foreach ($skill in $skills) {
    Write-Host "Inspecting $skill..."
    Add-Content -Path $reportFile -Encoding UTF8 -Value @("## $skill", '')

    $inspectOut = New-TemporaryFile
    $verifyOut = New-TemporaryFile
    $installOut = New-TemporaryFile

    try {
        $inspectExitCode = Invoke-ExternalToFile -FilePath $clawhubCommand -Arguments @('inspect', $skill) -OutputPath $inspectOut
        if ($inspectExitCode -ne 0) {
            Add-Content -Path $reportFile -Encoding UTF8 -Value @('SKIP: inspect failed', '')
            Get-Content $inspectOut | ForEach-Object {
                Add-Content -Path $reportFile -Encoding UTF8 -Value "    $_"
            }
            Add-Content -Path $reportFile -Encoding UTF8 -Value ''
            continue
        }

        $verifyExitCode = Invoke-ExternalToFile -FilePath $openclawCommand -Arguments ($openclawPrefix + @('skills', 'verify', $skill)) -OutputPath $verifyOut
        if ($verifyExitCode -ne 0) {
            Add-Content -Path $reportFile -Encoding UTF8 -Value @('SKIP: verify failed', '')
            Get-Content $verifyOut | ForEach-Object {
                Add-Content -Path $reportFile -Encoding UTF8 -Value "    $_"
            }
            Add-Content -Path $reportFile -Encoding UTF8 -Value ''
            continue
        }

        if ($VerifyOnly) {
            Add-Content -Path $reportFile -Encoding UTF8 -Value @("VERIFIED: $skill", '')
            continue
        }

        $installArgs = $openclawPrefix + @('skills', 'install', $skill, '--global')
        if ($Force) {
            $installArgs += '--force'
        }

        $installExitCode = Invoke-ExternalToFile -FilePath $openclawCommand -Arguments $installArgs -OutputPath $installOut
        if ($installExitCode -eq 0) {
            Add-Content -Path $reportFile -Encoding UTF8 -Value @("INSTALLED: $skill", '')
        } else {
            Add-Content -Path $reportFile -Encoding UTF8 -Value @('SKIP: install failed', '')
            Get-Content $installOut | ForEach-Object {
                Add-Content -Path $reportFile -Encoding UTF8 -Value "    $_"
            }
            Add-Content -Path $reportFile -Encoding UTF8 -Value ''
        }
    } finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $inspectOut, $verifyOut, $installOut
    }
}

Write-Host "Skill installation report written to $reportFile"
