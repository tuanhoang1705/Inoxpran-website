# inoxpran-blog-image-brief

Description: Create safe image prompts, alt text, and fallback image metadata for Inoxpran SEO posts.

Default behavior:
- Return `imageGenerationMode: "prompt_only"` unless a verified provider skill and provider API key are configured.
- Use `/images/og-image.png` as the safe fallback image URL unless the run provides a generated/uploaded image URL.

Output JSON:

```json
{
  "imageGenerationMode": "prompt_only",
  "heroPrompt": "",
  "negativePrompt": "",
  "altText": "",
  "caption": "",
  "filenameSlug": "",
  "recommendedAspectRatio": "16:9",
  "safeFallbackImageUrl": "/images/og-image.png",
  "usageNotes": []
}
```

Prompt rules:
- Prefer realistic Vietnamese kitchen scenes, clean stainless cookware, soft daylight, and useful context.
- Do not show logos, certifications, warranty badges, health claims, or origin labels unless provided in source assets.
- Do not create deceptive before/after comparisons.
- Avoid text inside images unless a verified image model is selected for accurate typography.
- Alt text must describe the image, not stuff keywords.
