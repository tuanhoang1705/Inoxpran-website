# ClawHub Skill Selection For Daily SEO Blogs

Research date: 2026-07-07

Goal: choose a safe ClawHub-backed core for a multi-agent daily blog system covering research, insight, positioning, ideation, content, image planning, review, and draft publishing.

## Core Skills

These are installed by `scripts/openclaw/install-skills.sh` and `scripts/openclaw/install-skills.ps1` only after `clawhub inspect` and `openclaw skills verify` pass.

| Install slug | OpenClaw skill ID | Role | Verify result on local machine | Notes |
| --- | --- | --- | --- | --- |
| `skill-vetter` | `skill-vetter` | Skill safety review | pass | Instruction-only vetting checklist. |
| `ddg-web-search` | `ddg-search` | Keyless web search fallback | pass | Narrow DuckDuckGo Lite search helper. |
| `firecrawl-api` | `firecrawl` | Search/scrape/crawl | pass | Powerful web extraction. Requires careful query scope and optional `FIRECRAWL_API_KEY`. |
| `market-research` | `Market Research` | Insight, segmentation, competitor positioning | pass | Useful for audience pain, whitespace, and positioning. |
| `deep-research-agent` | `research-agent` | Source-backed research reports | pass | Use only in research agents, never publisher. |
| `content-generation` | `content-generation` | Article/content drafting support | pass | Used by ideator, strategist, and writer. |
| `image-generation` | `AI Image Generation` | Image prompt/model guidance | pass | Core uses prompt/brief generation. Actual image provider remains optional. |

## Local Skills

These repository-local skills fill gaps where suitable ClawHub SEO skills were pending/fail:

| Skill | Role |
| --- | --- |
| `inoxpran-brand-voice` | Vietnamese brand voice and claim boundaries. |
| `inoxpran-search-console` | Placeholder for Search Console notes. |
| `inoxpran-seo-research-brief` | Keyword, SERP, content-gap, and source-note schema. |
| `inoxpran-positioning` | Audience, objection, positioning, and claim constraints. |
| `inoxpran-topic-planner` | Daily topic scoring and calendar slot selection. |
| `inoxpran-blog-image-brief` | Image prompt, alt text, caption, and fallback image URL. |
| `inoxpran-seo-review` | SEO/brand/claim review JSON. |
| `inoxpran-seo-publisher` | HMAC-signed backend publish/draft API call. |

## Not Installed Automatically

These skills are relevant but not part of the auto-install core at this time:

| Skill | Reason |
| --- | --- |
| `keyword-research` | `openclaw skills verify` failed because security/card status was pending. |
| `serp-analysis` | `openclaw skills verify` failed because security/card status was pending. |
| `content-gap-analysis` | `openclaw skills verify` failed because security/card status was pending. |
| `openclaw-seo-content-engine` | Verify failed; scanner flagged live Chrome usage and hard-coded local API-key path. |
| `blog-writing` | Verify failed; scanner flagged shell/full-security subagent requests. |
| `citedy-seo-agent` | Verify failed; scanner flagged broad credit spending, public publishing, deletes, and recurring automation. |
| `multi-search-engine` | Verify failed; scanner flagged third-party query/privacy risk. |
| `skillscan` | Verify failed; scanner flagged upload/telemetry/self-update behavior. |
| `nano-banana-pro` | Slug is ambiguous across multiple owners; choose and vet a specific owner manually before use. |

## Source Pages Reviewed

- https://clawhub.ai/
- https://clawhub.ai/ivangdavila/skills/market-research
- https://clawhub.ai/jahonn/skills/deep-research-agent
- https://clawhub.ai/tobisamaa/skills/content-generation
- https://clawhub.ai/ivangdavila/skills/image-generation
- https://clawhub.ai/dreamsarts/skills/openclaw-seo-content-engine
- https://clawhub.ai/justinbao19/skills/blog-writing
- https://clawhub.ai/nttylock/skills/citedy-seo-agent
- https://clawhub.ai/aaron-he-zhu/skills/keyword-research
- https://clawhub.ai/aaron-he-zhu/skills/serp-analysis
- https://clawhub.ai/aaron-he-zhu/skills/content-gap-analysis

## Manual Reconsideration

To reconsider a skipped skill later:

```bash
clawhub inspect <slug> --files
openclaw skills verify <slug>
```

Install only when verify returns `decision: "pass"` and the skill does not request publisher, shell, browser, database, admin UI, secret access, or public posting powers beyond its agent role.
