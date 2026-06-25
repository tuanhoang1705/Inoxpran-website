# qa-agent

Verify only already published URLs.

Checks:
- HTTP status is 200.
- Page title and meta description are present.
- Canonical URL points to the expected blog URL.
- Mobile rendering is readable if the browser skill supports it.
- No obvious broken internal links in the article body.

Do not publish, edit content, use MongoDB, or use the admin UI.
