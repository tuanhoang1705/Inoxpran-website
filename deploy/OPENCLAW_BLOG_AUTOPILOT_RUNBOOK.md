# OpenClaw Blog Autopilot — Production Runbook

Runbook này dành cho người vận hành. Không chép giá trị secret vào lệnh, log,
ticket hoặc tài liệu; mọi secret phải được cấp qua secret store của nền tảng.
Quy trình phát hành và rollback hạ tầng vẫn phải tuân theo
[`PRODUCTION_RELEASE_RUNBOOK.md`](./PRODUCTION_RELEASE_RUNBOOK.md).

## 1. Kiến trúc và authority

```text
Admin/API
   -> execution duy nhất, bền vững trong MongoDB
   -> openclaw-worker nhận lease và heartbeat
   -> OpenClaw Gateway /v1/responses
   -> các agent thật: research, ideation, writer, reviewer
   -> kiểm tra schema, model provenance, evidence và quality gate
   -> commit bản nháp theo executionKey (idempotent)
```

- API chỉ tạo/lập lịch execution; không chạy pipeline trong request.
- MongoDB là nguồn sự thật cho `executionKey`, trạng thái, lần thử, `retryAt`,
  stage, correlation và draft đã commit.
- `openclaw-worker` là **scheduler authority duy nhất** ở production.
  `backend` phải có `OPENCLAW_EMBEDDED_WORKER=false`.
- Không tạo cùng lịch blog trong OpenClaw native cron, n8n, system cron hay một
  Compose project thứ hai. Gateway chỉ thực thi agent, không sở hữu lịch blog.
- Worker gọi agent bằng `openclaw/<agentId>` và chỉ chấp nhận provider/model
  provenance nằm trong allowlist đã duyệt.
- Local embedded worker là tiện ích **chỉ dành cho development**. Production
  Compose luôn dùng service `openclaw-worker`.

## 2. Cấu hình bắt buộc

Chỉ kiểm tra sự hiện diện/định dạng; không in giá trị.

### Runtime và kết nối

- `NODE_ENV=production`
- `MONGODB_URI`
- `REDIS_ENABLED=true`, `REDIS_REQUIRED=true` và các biến Redis/TLS tương ứng
- các scoped API key production, đặc biệt `OPENCLAW_INTERNAL_API_KEY`
- `OPENCLAW_GATEWAY_HTTP_URL`, `OPENCLAW_GATEWAY_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_WRITER_MODEL`, `OPENAI_IDEATION_MODEL`
- `OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS`
- `OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL`
- `SEO_AGENT_ENABLED=true`
- `OPENCLAW_BLOG_CRON_ENABLED=true`
- `OPENCLAW_EMBEDDED_WORKER=false`
- `OPENCLAW_NO_AUTO_UPDATE=1`

### Retry và worker

| Biến | Mặc định | Giới hạn runtime |
|---|---:|---:|
| `OPENCLAW_BLOG_CRON_POLL_MS` | 30.000 ms | 5.000–300.000 ms |
| `OPENCLAW_BLOG_RETRY_MAX_ATTEMPTS` | 3 | 1–10 |
| `OPENCLAW_BLOG_RETRY_BASE_MS` | 30.000 ms | 1.000–1.800.000 ms |
| `OPENCLAW_BLOG_RETRY_MAX_MS` | 900.000 ms | tối đa 86.400.000 ms, không thấp hơn base |
| `OPENCLAW_AGENT_TRANSPORT_MAX_ATTEMPTS_PER_PHASE` | 3 | 1–5 |
| `OPENCLAW_AGENT_RETRY_BASE_MS` | 500 ms | 100–30.000 ms |
| `OPENCLAW_TOPIC_AGENT_TIMEOUT_MS` | 240.000 ms | 1.000–300.000 ms |
| `OPENCLAW_WORKER_DRAIN_TIMEOUT_MS` | 15.000 ms | 1.000–60.000 ms |
| `OPENCLAW_WORKER_HEALTH_PORT` | 3057 | 1–65.535 |

Transport retry áp dụng cho timeout/unreachable và HTTP
`408/425/429/500/502/503/504`; lỗi auth, config, model hoặc validation không
được retry mù. Execution retry dùng backoff lũy thừa, nhưng giữ nguyên
`executionKey` và document MongoDB.

### Khóa an toàn draft-only

Các biến sau phải là `false`; runtime production từ chối khởi động nếu cờ
auto-mutation bị bật:

- `SEO_AGENT_AUTO_PUBLISH`
- `INOXPRAN_SEO_AGENT_AUTO_PUBLISH`
- `OPENCLAW_BLOG_AUTO_PUBLISH`
- `AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH`
- `CONTENT_LEARNING_AUTO_APPLY`
- `OPENCLAW_UPDATE_ENABLED`

Mỗi lịch production phải có `draftOnly=true`. Autopilot chỉ tạo bản nháp; xuất
bản công khai vẫn cần quy trình phê duyệt riêng.

## 3. Preflight

- [ ] Release dùng image/revision bất biến, đã qua test và evidence review.
- [ ] `docker compose config --quiet` thành công mà không in cấu hình.
- [ ] Secret store có đủ tên biến bắt buộc; không đọc giá trị trong terminal.
- [ ] Production index dry-run không có blocker và index unique
      `executionKey` đã được xác minh theo release runbook.
- [ ] Chỉ một `openclaw-worker` có quyền claim; backend embedded worker tắt.
- [ ] Không có OpenClaw cron, n8n hoặc system cron trùng lịch blog.
- [ ] Gateway agent/workspace/skill mounts đúng revision đã duyệt và read-only.
- [ ] Model thực tế khớp expected model và resolved-model allowlist.
- [ ] Các cờ publish/auto-mutation liên quan vẫn tắt, lịch là draft-only.
- [ ] MongoDB/Redis backup, restore drill và previous compatible image còn dùng
      được.
- [ ] Candidate slot qua toàn bộ health/smoke trước khi chuyển traffic; không
      dùng single-slot `docker compose up` như một production release.

## 4. Khởi động và health

Khởi động dependency, API, Gateway, rồi `openclaw-worker`. Chỉ chuyển traffic
sau khi các probe sau đạt:

| Thành phần | Liveness | Readiness |
|---|---|---|
| API (`:3056`) | `GET /health/live` | `GET /health/ready` |
| Worker (`:3057`) | `GET /health/live` | `GET /health/ready` hoặc `/healthz` |
| OpenClaw Gateway (`:18789`) | `GET /healthz` | `GET /readyz`, sau đó kiểm tra authenticated `GET /v1/models` |
| Frontend (`:4173`) | `GET /healthz` | cùng probe của image |

Worker readiness phải cho thấy database sẵn sàng, Redis sẵn sàng nếu required,
scheduler/roadmap đã registered, heartbeat còn mới và không có
`lastErrorCode`. Sau đó kiểm tra trang Blog OpenClaw:

1. worker đang nhận claim;
2. lịch tiếp theo đúng múi giờ;
3. lần thành công gần nhất và bản nháp mở được;
4. một `run-now` smoke dùng `Idempotency-Key` mới, không tái sử dụng khóa của
   thao tác khác.

## 5. Theo dõi execution và xử lý sự cố

API vận hành:

- `GET /v1/api/admin/openclaw/blog-schedules/:scheduleId/executions`
- `GET /v1/api/admin/openclaw/blog-schedules/execution-summaries?scheduleIds=...`

Phân loại:

- `queued`, `running`, `committing`: đang xử lý; không bấm chạy lại.
- `retry_wait` + `failureClass=transient`: **không phải incident terminal**.
  Kiểm tra `currentStage`, `attemptCount/maxAttempts`, `retryAt`, health Gateway
  và worker; để worker thử lại cùng execution.
- `failed`, `blocked` hoặc `failureClass=terminal`: incident cần người xử lý.
  Ghi lại error code/stage/correlation trước khi sửa config, evidence hay input.
- `draft_created`, `maintenance_created`, `completed`, `published`: terminal
  thành công theo outcome. Production bình thường phải dừng ở draft/maintenance,
  không tự publish.

Không xóa execution, sửa `retryAt`, đổi `executionKey` hoặc tạo bản ghi MongoDB
thủ công. Chỉ chạy lại sau khi execution cũ đã terminal và nguyên nhân đã được
giải quyết.

## 6. Correlation

- Mọi HTTP request có `requestId` trong response/log.
- `run-now` lưu request đó thành `correlationId` của execution.
- `executionKey` là định danh idempotency bền vững; `id` là Mongo execution ID.
- Khi mở incident, ghi: thời gian UTC, schedule ID, execution ID,
  `executionKey`, `correlationId`, `currentStage`, attempt và error code.
- Tra log theo `requestId/correlationId`, rồi nối sang execution và các agent
  receipt; không đưa prompt, token hoặc response nhạy cảm vào ticket.

## 7. Graceful restart

1. Tạm pause lịch sắp tới nếu có nguy cơ đến hạn trong cửa sổ bảo trì.
2. Đợi worker health báo `scheduler.active=false` và không còn execution
   `running/committing`.
3. Gửi `SIGTERM`; cho process ít nhất thời gian shutdown đã cấu hình. Không
   `kill -9` khi agent hoặc commit đang chạy.
4. Xác nhận worker cũ `acceptingClaims=false`/đã dừng trước khi worker mới nhận
   claim.
5. Khởi động worker mới, chờ readiness, rồi resume lịch.

Nếu process chết giữa pipeline, không tạo run thay thế. Lease hết hạn sẽ cho
worker mới phục hồi execution cũ; commit dựa trên cùng `executionKey` ngăn tạo
draft trùng.

## 8. Rollback an toàn

1. Dừng tạo claim mới và để execution đang chạy drain.
2. Chuyển traffic về previous **schema-compatible** slot/image theo
   `PRODUCTION_RELEASE_RUNBOOK.md`.
3. Chỉ chạy một worker authority trong suốt chuyển đổi.
4. Không rollback về worker không hiểu `retry_wait`, retry metadata hoặc
   idempotent commit khi còn execution chưa terminal.
5. Không xóa draft/queue và không đoán database rollback. Ưu tiên forward fix;
   database restore chỉ theo backup/restore procedure đã kiểm chứng.
6. Sau rollback, chạy lại health, xác minh next run, kiểm tra không có duplicate
   execution/draft, rồi mới resume lịch.

Nếu không có previous image tương thích, giữ draft-only, pause lịch và thực
hiện forward fix thay vì ép rollback.
