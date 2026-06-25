#!/usr/bin/env bash
set -euo pipefail

API_URL="${SEO_AGENT_SMOKE_URL:-http://localhost:3056/v1/api/automation/seo-blog/publish}"
MODE="${SEO_AGENT_SMOKE_MODE:-draft}"
TIMESTAMP_SLUG="test-cach-chon-noi-inox-304-gia-dinh-viet-$(date +%Y%m%d%H%M%S)"
TEST_SLUG="${SEO_AGENT_TEST_SLUG:-${TIMESTAMP_SLUG}}"

echo "WARNING: This creates a test SEO blog draft through the automation API."
echo "Do not run on production unless you understand the resulting draft record."

required_env=(API_KEY SEO_AGENT_API_KEY SEO_AGENT_HMAC_SECRET)
missing_env=()
for env_name in "${required_env[@]}"; do
  if [ -z "${!env_name:-}" ]; then
    missing_env+=("${env_name}")
  fi
done

if [ "${#missing_env[@]}" -gt 0 ]; then
  echo "NOT RUN: missing required env var(s): ${missing_env[*]}"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "NOT RUN: node command is unavailable."
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "NOT RUN: curl command is unavailable."
  exit 0
fi

PAYLOAD="$(SEO_AGENT_SMOKE_MODE="${MODE}" SEO_AGENT_TEST_SLUG="${TEST_SLUG}" node <<'NODE'
const paragraph = 'Noi inox 304 phu hop voi gia dinh Viet khi nguoi dung can do ben, ve sinh de dang va kha nang su dung hang ngay tren nhieu loai bep. Bai viet nay chi dua ra huong dan lua chon thuc te, khong dua ra cam ket qua muc ve xuat xu, cong nghe hoac bao hanh. ';
const content = [
  '<section>',
  '<h2>Vi sao nen hieu dung ve noi inox 304</h2>',
  ...Array.from({ length: 18 }, () => `<p>${paragraph}</p>`),
  '<h2>Cac tieu chi can kiem tra</h2>',
  ...Array.from({ length: 18 }, () => `<p>${paragraph}</p>`),
  '<h2>Cach bao tri sau khi su dung</h2>',
  ...Array.from({ length: 18 }, () => `<p>${paragraph}</p>`),
  '</section>'
].join('');

const payload = {
  mode: process.env.SEO_AGENT_SMOKE_MODE || 'draft',
  source: 'openclaw-daily-seo',
  primaryKeyword: 'noi inox 304',
  secondaryKeywords: ['noi inox dung bep tu', 'cach chon noi inox'],
  title: '[TEST] Cach chon noi inox 304 cho gia dinh Viet',
  slug: process.env.SEO_AGENT_TEST_SLUG,
  excerpt: 'Ban nhap thu nghiem cho luong automation SEO cua Inoxpran.',
  contentHtml: content,
  seoTitle: '[TEST] Cach chon noi inox 304',
  seoDescription: 'Ban nhap thu nghiem automation SEO Inoxpran, mac dinh o che do draft.',
  categoryKey: 'guide',
  tags: ['test', 'inox 304', 'noi inox', 'Inoxpran'],
  authorName: 'Inoxpran Editorial Team',
  imageUrl: '/images/og-image.png',
  internalLinks: [{ title: 'Shop Inoxpran', url: '/shop?q=inox' }],
  faq: [{ question: 'Day co phai bai that khong?', answer: 'Khong, day la payload smoke test.' }],
  review: {
    seoScore: 90,
    brandSafety: 'pass',
    duplicateRisk: 'low',
    claimRisk: 'low'
  },
  metadata: {
    agentRunId: `smoke-${Date.now()}`,
    generatedAt: new Date().toISOString()
  }
};

process.stdout.write(JSON.stringify(payload));
NODE
)"

TIMESTAMP="$(date +%s%3N)"
SIGNATURE="$(PAYLOAD="${PAYLOAD}" node <<'NODE'
const crypto = require('node:crypto');
const payload = process.env.PAYLOAD || '';
const secret = process.env.SEO_AGENT_HMAC_SECRET || '';
process.stdout.write(crypto.createHmac('sha256', secret).update(payload).digest('hex'));
NODE
)"

curl --fail-with-body --silent --show-error \
  --request POST "${API_URL}" \
  --header "Content-Type: application/json" \
  --header "x-api-key: ${API_KEY}" \
  --header "x-seo-agent-key: ${SEO_AGENT_API_KEY}" \
  --header "x-openclaw-timestamp: ${TIMESTAMP}" \
  --header "x-openclaw-signature: ${SIGNATURE}" \
  --data "${PAYLOAD}"

echo
