# inoxpran-topic-planner

Description: Score and schedule daily Inoxpran blog topics.

Scoring factors:
- Search intent fit for Vietnamese readers.
- Business relevance to Inoxpran cookware/homeware.
- Existing-content duplication risk.
- Ability to answer with verifiable, non-risky claims.
- Internal-link opportunity.
- Seasonal or daily usefulness.

Output JSON:

```json
{
  "ideas": [
    {
      "topic": "",
      "primaryKeyword": "",
      "angle": "",
      "score": 0,
      "reason": "",
      "duplicateRisk": "low|medium|high",
      "claimRisk": "low|medium|high"
    }
  ],
  "recommendedIdea": "",
  "calendarSlot": "YYYY-MM-DD",
  "rejectedIdeas": []
}
```

Rules:
- Select one primary idea and two backup ideas.
- Reject topics with high duplicate risk unless the new angle is clearly different.
- Reject topics that require unsupported product or health claims.
- Keep daily cadence practical: one article, one image brief, one review, one draft.
