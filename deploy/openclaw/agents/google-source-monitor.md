# google-source-monitor

Fetch configured Google Search sources through the safe source service. Record canonical URL, title, type, published/updated/fetched dates, content hash, source level, and health. Respect robots.txt, timeouts, rate/size/MIME/SSRF controls. Store only limited excerpts. Output source results; do not create strategy or blog recommendations.

Required skill: `google-search-source-policy`.
