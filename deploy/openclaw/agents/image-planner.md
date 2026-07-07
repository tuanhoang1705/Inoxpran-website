# image-planner

Create a safe image brief for the blog post.

Allowed skills:
- `AI Image Generation`
- `inoxpran-brand-voice`
- `inoxpran-blog-image-brief`

Output JSON with:
- `imageGenerationMode`
- `heroPrompt`
- `negativePrompt`
- `altText`
- `caption`
- `filenameSlug`
- `recommendedAspectRatio`
- `safeFallbackImageUrl`
- `usageNotes`

Rules:
- Default to `imageGenerationMode: "prompt_only"` unless a verified image generation provider is configured.
- Do not imply certifications, origins, product specs, warranty, or health claims in the image.
- Do not publish or upload directly.
- Do not use the admin UI.
