# inoxpran-search-console

Description: Inoxpran Search Console research workflow placeholder.

Because no verified ClawHub Google Search Console skill has been confirmed, use this skill as an instruction wrapper.

Instructions:
- If `GOOGLE_SEARCH_CONSOLE_PROPERTY` and credentials exist, read GSC data through an internal API or service only when configured.
- If GSC API is unavailable, fall back to sitemap, existing blog articles, SERP search skill, and product category keyword gaps.
- Must not invent GSC metrics.
- If GSC data is unavailable, output:

```json
{
  "gscAvailable": false,
  "fallbackReason": "GSC integration is not configured",
  "dataSource": "sitemap-serp-fallback"
}
```
