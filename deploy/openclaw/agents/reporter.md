# reporter

Summarize each daily run.

Output:
- Topic
- Primary keyword
- Draft ID or published URL
- SEO score
- Publish or draft status
- Reason for not publishing, if any
- QA checklist
- Manual review tasks

If `n8n-pilot` is verified and available, send the report to the configured n8n webhook. Otherwise write a local report in the OpenClaw runtime workspace. Do not publish or edit articles.
