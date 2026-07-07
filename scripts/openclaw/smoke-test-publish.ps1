param(
    [string]$ApiUrl = $env:SEO_AGENT_SMOKE_URL,
    [string]$Mode = $env:SEO_AGENT_SMOKE_MODE
)

$ErrorActionPreference = 'Stop'

if (-not $ApiUrl) {
    $ApiUrl = 'http://localhost:3056/v1/api/automation/seo-blog/publish'
}
if (-not $Mode) {
    $Mode = 'draft'
}

Write-Host 'WARNING: This creates a test SEO blog draft through the automation API.'
Write-Host 'Do not run on production unless you understand the resulting draft record.'

$missing = @()
foreach ($name in @('API_KEY', 'SEO_AGENT_API_KEY', 'SEO_AGENT_HMAC_SECRET')) {
    if (-not [Environment]::GetEnvironmentVariable($name)) {
        $missing += $name
    }
}

if ($missing.Count -gt 0) {
    Write-Host "NOT RUN: missing required env var(s): $($missing -join ', ')"
    exit 0
}

$timestampSlug = "test-cach-chon-noi-inox-304-gia-dinh-viet-$((Get-Date).ToString('yyyyMMddHHmmss'))"
$testSlug = if ($env:SEO_AGENT_TEST_SLUG) { $env:SEO_AGENT_TEST_SLUG } else { $timestampSlug }

$paragraph = 'Noi inox 304 phu hop voi gia dinh Viet khi nguoi dung can do ben, ve sinh de dang va kha nang su dung hang ngay tren nhieu loai bep. Bai viet nay chi dua ra huong dan lua chon thuc te, khong dua ra cam ket qua muc ve xuat xu, cong nghe hoac bao hanh. '
$contentParts = @('<section>', '<h2>Vi sao nen hieu dung ve noi inox 304</h2>')
for ($i = 0; $i -lt 18; $i++) { $contentParts += "<p>$paragraph</p>" }
$contentParts += '<h2>Cac tieu chi can kiem tra</h2>'
for ($i = 0; $i -lt 18; $i++) { $contentParts += "<p>$paragraph</p>" }
$contentParts += '<h2>Cach bao tri sau khi su dung</h2>'
for ($i = 0; $i -lt 18; $i++) { $contentParts += "<p>$paragraph</p>" }
$contentParts += '</section>'
$content = $contentParts -join ''

$payloadObject = [ordered]@{
    mode = $Mode
    source = 'openclaw-daily-seo'
    primaryKeyword = 'noi inox 304'
    secondaryKeywords = @('noi inox dung bep tu', 'cach chon noi inox')
    title = '[TEST] Cach chon noi inox 304 cho gia dinh Viet'
    slug = $testSlug
    excerpt = 'Ban nhap thu nghiem cho luong automation SEO cua Inoxpran.'
    contentHtml = $content
    seoTitle = '[TEST] Cach chon noi inox 304'
    seoDescription = 'Ban nhap thu nghiem automation SEO Inoxpran, mac dinh o che do draft.'
    categoryKey = 'guide'
    tags = @('test', 'inox 304', 'noi inox', 'Inoxpran')
    authorName = 'Inoxpran Editorial Team'
    imageUrl = '/images/og-image.png'
    internalLinks = @(@{ title = 'Shop Inoxpran'; url = '/shop?q=inox' })
    faq = @(@{ question = 'Day co phai bai that khong?'; answer = 'Khong, day la payload smoke test.' })
    review = @{
        seoScore = 90
        brandSafety = 'pass'
        duplicateRisk = 'low'
        claimRisk = 'low'
        imageSafety = 'pass'
    }
    metadata = @{
        agentRunId = "smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        imageBrief = @{
            imageGenerationMode = 'prompt_only'
            safeFallbackImageUrl = '/images/og-image.png'
        }
    }
}

$payload = $payloadObject | ConvertTo-Json -Depth 12 -Compress
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
$secretBytes = [Text.Encoding]::UTF8.GetBytes($env:SEO_AGENT_HMAC_SECRET)
$payloadBytes = [Text.Encoding]::UTF8.GetBytes($payload)
$hmac = [Security.Cryptography.HMACSHA256]::new($secretBytes)
$signatureBytes = $hmac.ComputeHash($payloadBytes)
$signature = -join ($signatureBytes | ForEach-Object { $_.ToString('x2') })

$headers = @{
    'x-api-key' = $env:API_KEY
    'x-seo-agent-key' = $env:SEO_AGENT_API_KEY
    'x-openclaw-timestamp' = $timestamp
    'x-openclaw-signature' = $signature
}

Invoke-RestMethod -Method Post -Uri $ApiUrl -ContentType 'application/json' -Headers $headers -Body $payload
