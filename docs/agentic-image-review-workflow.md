# Agentic image review workflow

## Overview

The admin blog editor exposes image approval and replacement tools only for posts created by the OpenClaw automation pipeline. Manual posts keep the existing upload and rich-text editing behavior.

An agentic post cannot be published until every persisted cover and inline image has a `reviewStatus` of `approved` or `replaced`.

## Post classification

- New OpenClaw posts are stored with `sourceType: "agentic"` and `generationMetadata.provider: "openclaw"`.
- New admin-created posts are stored with `sourceType: "manual"`.
- Legacy posts without `sourceType` are treated as agentic only when they contain automation artifacts such as `visualPlan`, `contentImages`, OpenClaw metadata, or an AI/licensed-search cover.

Manual posts never render approval, AI generation, prompt suggestion, Pexels, or local replacement controls.

## Image metadata

Each cover or inline image uses:

- `imageId`: stable target identifier (`cover` or an `inline-*` id).
- `reviewStatus`: `pending_review`, `approved`, `rejected`, or `replaced`.
- `sourceType`: for example `ai_generation`, `licensed_search`, or `manual_upload`.
- `replacementMetadata`: previous URL, replacement source, and replacement timestamp.

Legacy inline images receive a deterministic id based on URL, heading index, and array position. New pipeline HTML also includes `data-image-id` on its `<figure>` and `<img>`.

For legacy posts where `contentImages[].url` no longer matches the editor HTML, the admin sends the image's current DOM `src` and `imageIndex`. The backend resolves targets in this order: `data-image-id`, current/old URL, normalized storage path, then validated image index. Target validation runs before upload, so a missing target returns `404` without creating an orphan replacement file.

## Admin UI flow

1. Open an agentic post in `/admin/blogs/:postId`.
2. Use **Duyệt ảnh** or **Từ chối** under the cover.
3. Hover or click an inline image to display its compact review toolbar.
4. Rejecting an image opens a native modal dialog in the browser top layer.
5. Choose **Tạo ảnh AI** or **Tìm trên Pexels**.
6. The current replacement dialog supports three sources: AI generation, Pexels search, and local file upload from the admin's computer.
7. Preview the candidate and confirm it.
8. The backend uploads the optimized WebP and replaces only the selected target.

Images in `approved`, `rejected`, and `replaced` states remain editable. Their **Edit image** action reopens the same replacement dialog. An admin-confirmed replacement is stored as `replaced` and is treated as reviewed.

## AI replacement

- The dialog loads three prompt suggestions from the post title, excerpt, headings, and selected image section.
- An admin may select a suggestion or edit a custom prompt.
- The backend calls the configured AI image provider, converts the result to WebP, and returns a temporary data preview.
- The image is uploaded only after confirmation.

Required environment variables:

```dotenv
AI_IMAGE_PROVIDER=openai
AI_IMAGE_API_KEY=...
AI_IMAGE_MODEL=gpt-image-2
AI_IMAGE_QUALITY=low
```

## Pexels replacement

- Search requests are server-side and never expose the API key.
- The first request returns at most 10 landscape images.
- **Xem thêm** requests the next page of 10 results.
- Confirmation sends only the Pexels asset id. The backend resolves that id again through Pexels before downloading and storing the image.

Required environment variables:

```dotenv
IMAGE_SEARCH_PROVIDER=pexels
IMAGE_SEARCH_API_KEY=...
```

## Local file replacement

- The replacement dialog includes a **From computer** tab for agentic cover and inline images.
- Admins can choose or drag/drop JPG, PNG, WebP, or another browser-supported image file up to 5MB.
- The SvelteKit proxy forwards a `multipart/form-data` request with `target`, `selection`, and file field `image`.
- `selection.kind` is `local_upload`. The backend validates the file, optimizes it to WebP, uploads it, and persists the image with `sourceType: "manual_upload"` and `reviewStatus: "replaced"`.
- Local replacement uses the same target resolution and pre-upload validation as AI/Pexels replacement, so a missing inline target returns `404` before storage upload.

## Backend endpoints

All endpoints require existing admin authentication and permissions.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v1/api/blog/admin/:blogId/images/suggestions` | Build contextual prompt suggestions |
| `GET` | `/v1/api/blog/admin/:blogId/images/pexels` | Search Pexels with pagination |
| `POST` | `/v1/api/blog/admin/:blogId/images/generate` | Generate an optimized preview |
| `PATCH` | `/v1/api/blog/admin/:blogId/images/review` | Approve or reject one exact target |
| `POST` | `/v1/api/blog/admin/:blogId/images/replace` | Upload and persist a confirmed replacement from AI, Pexels, or local file |

The SvelteKit admin proxies these endpoints through `/admin/api/blogs/:postId/images/:operation`.

Invalid target types return `400`. Missing inline metadata or HTML targets return `404`. Replacement logs contain only the blog id, target type/identifier, replacement source, status, and error name; provider keys and image data are never logged.

## Blog list presentation

`/admin/blogs` displays translated category, read-time, and source labels through the admin VI/EN dictionary. Unknown categories fall back to `Khác` or `Other`. Each card shows an `Agentic` or `Thủ công`/`Manual` badge, and the source filter supports all, Agentic, and manual posts while retaining legacy source inference.

## Test procedure

1. Start backend and frontend.
2. Open an agentic draft with cover and inline image metadata.
3. Verify cover actions are visible.
4. Hover each inline image and verify actions target only that image.
5. Reject an image and verify the dialog is above the editor and floating widgets.
6. Generate an AI preview, cancel, and confirm no post data changed.
7. Generate again and confirm; refresh and verify the new URL persists.
8. Search Pexels, verify 10 results, use **Xem thêm**, select and confirm.
9. Choose **From computer**, select a local image under 5MB, confirm, refresh, and verify the new URL persists as `manual_upload` with `reviewStatus: "replaced"`.
10. Open a manual post and verify none of the Agentic controls are rendered.
11. Attempt to publish an Agentic post with pending images and verify the backend rejects it.

Automated checks:

```bash
cd backend
npm test

cd ../frontend
npm run build
```

## Known limitations

- Replaced storage objects are retained instead of being deleted immediately. This avoids deleting an object still referenced by another post; lifecycle cleanup should remove unreferenced objects separately.
- AI preview generation can take up to the provider timeout and consumes provider credit even if the preview is cancelled.
- Legacy HTML without a matching metadata entry cannot show an inline review toolbar until its image metadata is repaired.
