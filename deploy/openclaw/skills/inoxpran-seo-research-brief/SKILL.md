# inoxpran-seo-research-brief

Description: Build a safe, source-backed SEO research brief for Inoxpran blog automation.

Use this skill when the agent needs keyword, SERP, content-gap, or competitor-angle notes but cannot use an unverified third-party SEO skill.

Inputs:
- Brand context from `inoxpran-brand-voice`
- Search Console notes if available
- Public search results or scraped competitor pages
- Existing Inoxpran sitemap/blog URLs when available

Output JSON:

```json
{
  "primaryKeyword": "",
  "secondaryKeywords": [],
  "searchIntent": "informational|commercial|comparison|care",
  "serpIntentNotes": [],
  "peopleAlsoAsk": [],
  "competitorAngles": [],
  "contentGaps": [],
  "existingContentRisk": "low|medium|high",
  "recommendedInternalLinks": [],
  "sourceNotes": [
    {
      "url": "",
      "claimSupported": "",
      "confidence": "low|medium|high"
    }
  ]
}
```

Rules:
- Label every factual claim with a source note or mark it as an inference.
- Prefer Vietnamese search intent and buying/care language.
- Do not infer product origin, warranty, material certification, or safety claims without a source.
- If search data is weak, say so and lower confidence.
- Do not publish, upload, or access any database.
