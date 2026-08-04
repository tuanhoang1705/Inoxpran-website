# n8n

The OpenClaw chat workflow has been removed from this project.

Current status:

- `n8n` is no longer required for the website chatbox
- the customer chatbox now uses `frontend -> /api/chat/message -> OpenAI + agent knowledge`
- there is no bundled chat-lead reminder workflow in this repo anymore

If you keep `n8n` running for unrelated automations, maintain those workflows separately.

The Compose service is therefore behind the opt-in `automation` profile. Before
enabling it, provision `N8N_ENCRYPTION_KEY` through the deployment secret store
and set `N8N_DATA_HOST_PATH` to a dedicated, existing host directory outside
the repository checkout. The production preflight rejects relative paths,
symlinks into the checkout, and overlap with either OpenClaw runtime directory.
The container root filesystem is read-only; only the dedicated `.n8n` bind mount
and restricted temporary filesystems are writable.
Environment access from Code nodes and external/builtin module imports remain
blocked. Never rotate the encryption key in place without first migrating or
re-encrypting stored credentials.
