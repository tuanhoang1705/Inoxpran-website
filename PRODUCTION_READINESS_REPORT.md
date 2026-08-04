# Báo cáo production readiness

Ngày xác minh: 2026-07-30  
Quyết định release: **BLOCKED — chưa được triển khai production**

Code-level gates hiện đã xanh, nhưng release vẫn bị chặn fail-closed bởi secret
rotation/history scan, image build/scan, staging migration/canary và topology
chuyển traffic. Không có deployment, publish, auto-update, API trả phí hay thay
đổi dữ liệu production nào được thực hiện trong đợt xác minh này.

## Kết quả gate

| Gate                                | Kết quả     | Chi tiết                                                                            |
| ----------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| Backend full suite                  | PASS        | 78 file pass, 1 integration file skip; 923 pass, 3 skip, 0 fail                     |
| Backend syntax                      | PASS        | 321/321 file JS/MJS                                                                 |
| Mongo integration/index/idempotency | PASS        | 3/3 trên MongoDB 7.0.16 loopback và database cô lập                                 |
| Backend dependency audit            | PASS        | 0 info/low/moderate/high/critical                                                   |
| Frontend formatting + ESLint        | PASS        | Prettier 0 lệch, ESLint 0 lỗi                                                       |
| Frontend unit                       | PASS        | 134/134 test                                                                        |
| Frontend production build           | PASS        | Không có cảnh báo Svelte, a11y hoặc chunk >500 KB                                   |
| Frontend dependency audit           | PASS        | 0 info/low/moderate/high/critical                                                   |
| Playwright module-browser           | PASS        | 6/6; polling, offline/hidden, batch 1/10/50 và idempotency                          |
| Playwright ứng dụng thật            | PASS        | 7/7; login/admin thật, VI/EN, keyboard/mobile, 202/502/504, recovery và stale UI     |
| CI safety contract                  | PASS        | 7 job, action pin full SHA, quyền read-only, không push/publish/deploy              |
| Compose local/production structure  | PASS        | Local render đúng; production giữ Redis/TLS và immutable-image contract fail-closed  |
| Production container invocation     | **BLOCKED** | Chưa cấp 5 reviewed image digest; Docker Desktop daemon chưa hoạt động                |
| Security/release contract tests     | PASS        | 27/27; secret metadata, rotation proof, release evidence và manual updater policy   |
| Deploy guard                        | PASS        | Không tham số trả 2; preflight cục bộ chặn trước mutation                           |
| Git diff whitespace                 | PASS        | Không có whitespace error; chỉ có thông báo chuyển line ending của Git trên Windows |
| Gitleaks — current source           | PASS        | 0 finding trên 1.065 tracked và non-ignored untracked input                         |
| Gitleaks — toàn bộ lịch sử Git      | **FAIL**    | 55 finding, 19 file, 28 commit                                                      |
| Gitleaks — local ignored artifacts  | **FAIL**    | 82 finding, 12 file trên 7 target nhạy cảm cục bộ                                   |
| Container build/pull/scan thật      | **BLOCKED** | Docker daemon không hoạt động trên máy xác minh                                     |
| Release-evidence manifest thực      | **BLOCKED** | Chưa có manifest ngoài checkout và SHA-256 do control plane cấp                     |
| Staging canary/migration/restore    | **BLOCKED** | Chưa có staging DB, secret store và endpoint riêng                                  |

Hai lockfile đều qua `npm ci` trong thư mục tạm sạch và `npm ls --all` trả 0.
Còn một cảnh báo cài đặt không chặn gate: deprecation gián tiếp
`node-domexception@1.0.0`; package này hiện không có advisory trong audit.

## Incident Redis `ENOTFOUND` đã xử lý

- Nguyên nhân là backend chạy trực tiếp trên Windows nhưng root `.env` dùng
  hostname service Compose `redis`. Runtime local chỉ đọc root `.env`; file
  `backend/.env` không được nạp và không được dùng để chữa lỗi.
- Local hiện đặt Redis `disabled_optional` rõ ràng khi không có daemon. Backend
  đã tự restart, `/health/live` và `/health/ready` đều trả 200; readiness xác
  nhận MongoDB `ready`, Redis `disabled_optional`, và process không mở kết nối
  tới cổng Redis.
- Production Compose vẫn ép `REDIS_ENABLED=true`, `REDIS_REQUIRED=true`, TLS,
  CA mount, service DNS `redis` và `depends_on: service_healthy`. Runtime
  production từ chối tắt hai gate này.
- Initial connect/ping có deadline hữu hạn; dependency bắt buộc fail startup
  bằng mã sanitized thay vì treo. Redis optional chuyển degraded; command khi
  reconnect không bị queue âm thầm.
- Lỗi client lặp được gộp theo cửa sổ thời gian và chỉ ghi event/code cùng số
  lượng bị suppress, không ghi hostname, URL, credential hoặc raw message.
  Live-support dùng delivery cùng process khi Redis local bị tắt và shutdown
  destroy client đang reconnect thay vì chờ `QUIT` vô hạn.
- Probe DNS thật với hostname `.invalid` dừng sau 1.224 ms, trả
  `REDIS_STARTUP_UNAVAILABLE`, chỉ tạo một metadata log `ENOTFOUND`, và để
  client ở trạng thái đóng. Chín test Redis mới đều nằm trong tổng 889/889.

## Invariant an toàn đã khóa

- Roadmap acceptance luôn tối thiểu 82 và novelty tối thiểu 48 tại config,
  scoring, orchestrator, planning và blog core. Cấu hình downstream không thể
  hạ hai ngưỡng này.
- Evidence rỗng hoặc sai version/relevance trả
  `ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE`; preflight reachability chạy trước
  paid-agent call.
- Candidate lưu evidence ID, rubric/corpus version và score hash; model identity
  canonical chỉ lấy từ gateway/provider metadata và phải nằm trong allowlist.
- Production runtime ép `auto_publish=false` kể cả database từng lưu override
  cũ; thao tác bật lại bị từ chối và trả trạng thái `policyLocked`.
- Override runtime đã lưu không thể bật lại blog cron nếu model/gateway/allowlist
  mất readiness; Telegram production chỉ cho webhook, không cho polling.
- n8n chỉ khởi động khi có data path host riêng ngoài checkout; root filesystem
  read-only, env access trong Code node bị chặn và encryption key vẫn bắt buộc.
- OpenClaw updater không còn fallback `latest`: chỉ nhận image version+digest,
  release commit và approval gắn đúng digest qua quy trình thủ công có audit.
- Các cờ sau phải giữ nguyên:

  - `SEO_AGENT_AUTO_PUBLISH=false`
  - `INOXPRAN_SEO_AGENT_AUTO_PUBLISH=false`
  - `AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH=false`
  - `OPENCLAW_BLOG_AUTO_PUBLISH=false`
  - `CONTENT_LEARNING_AUTO_APPLY=false`
  - `OPENCLAW_UPDATE_ENABLED=false`
  - `OPENCLAW_NO_AUTO_UPDATE=1`

- Schedule release tiếp tục `draftOnly=true`, `autoPublish=false`.
- CI không có bước publish, image push, deploy, release mutation hoặc
  `pull_request_target`.

## Secret và artifact blocker

Không có giá trị secret nào được ghi vào báo cáo.

- Gitleaks full-history: 55 finding gồm 39 generic API key, 9 OpenAI key và
  7 private key; phân bố trên 19 file và 28 commit.
- Các scope nhạy cảm cục bộ hiện có 82 pattern match, có thể trùng cùng một
  credential:

  - root `.env`: 8
  - `backend/.env`: 3
  - `frontend/.env`: 1
  - `.local-secret-backups`: 2
  - `.tmp-chrome-trace`: 65
  - `deploy/openclaw-lab`: 3

- Production preflight đang chặn ngay tại
  `LOCAL_SENSITIVE_ARTIFACT_PRESENT:.env`.
- CI quét snapshot hiện tại và toàn bộ lịch sử qua
  `.github/scripts/secret-scan-metadata.mjs`. Scanner gốc bị tắt output; log chỉ
  còn count theo rule/phân loại và không chứa match, secret, đường dẫn, tác giả,
  email, commit message hay fingerprint. Test fixture vẫn nằm trong gate, không
  được miễn trừ.
- Không tự xóa các file cấu hình của operator và không rewrite lịch sử Git.
  Khóa từng xuất hiện trong Git/trace phải được thu hồi hoặc xoay trước, sau đó
  mới thực hiện cleanup có kiểm kê và review.
- Worktree vẫn rất bẩn: 349 tracked-change entry và 135 untracked file theo
  `git status --porcelain=v1 -uall`.
  `.github/`, `backend/package-lock.json`, `DEPENDENCY_SECURITY.md`, runbook và
  các file triển khai mới phải được review rồi đưa vào release commit.
  `Tom-tat-phien-OpenClaw-Blog.docx` là file người dùng và không bị thay đổi.

## Capability chưa được phép tô xanh

| Capability       | Trạng thái release                       | Điều kiện để bật                                                                        |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| n8n              | `expected_disabled`                      | Encryption key, image digest đã scan, external data storage/backup, HTTPS webhook smoke |
| Telegram         | `expected_disabled`                      | `ADMIN_BASE_URL` HTTPS, credential/allowlist/webhook và smoke test                      |
| Content signals  | `expected_disabled` hoặc `pending_check` | Feature bật rõ ràng và có dữ liệu thật                                                  |
| Image pipeline   | `expected_disabled` hoặc `pending_check` | Provider key, execution/artifact thật và probe đúng pipeline                            |
| OpenClaw updater | `expected_disabled`                      | Chỉ update thủ công có audit; không bật Docker socket/self-update                       |

Capability bị tắt có chủ đích là trạng thái trung tính; chỉ capability bắt buộc
hoặc đã bật nhưng không khỏe mới chặn readiness.

## Cấu hình cần cấp ngoài cuộc trò chuyện

Cấp qua secret/config store hoặc file mount, không gửi giá trị vào chat:

- Core: `MONGODB_URI`, `JWT_SECRET`, `PUBLIC_API_KEY`, `USER_API_KEY`,
  `ADMIN_BFF_API_KEY`, `OPENCLAW_INTERNAL_API_KEY`, `REDIS_PASSWORD` và bộ
  Redis TLS; production giữ `REDIS_ENABLED=true`, `REDIS_REQUIRED=true`;
  `APP_BASE_URL`, `API_BASE_URL`, `PUBLIC_SITE_URL`,
  `ADMIN_BASE_URL`, `CORS_ORIGIN`.
- Blog/OpenClaw: `OPENAI_API_KEY`, `OPENAI_WRITER_MODEL`,
  `OPENAI_IDEATION_MODEL`, `OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS`,
  `OPENCLAW_GATEWAY_HTTP_URL`, `OPENCLAW_GATEWAY_TOKEN`,
  `SEO_AGENT_API_KEY`, `SEO_AGENT_HMAC_SECRET`,
  `CONTENT_OPERATIONS_AUDIT_HMAC_SECRET`.
- Immutable runtime: `NODE_RUNTIME_IMAGE`, `REDIS_IMAGE`, `NGINX_IMAGE`,
  `CERTBOT_IMAGE`, `OPENCLAW_IMAGE`; thêm `N8N_IMAGE` chỉ khi bật automation.
  Mỗi reference phải có version tag không phải `latest` và digest SHA-256 thật.
- Persistent/config mounts: `REDIS_TLS_CERT_DIR`,
  `GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH`, `OPENCLAW_DATA_HOST_PATH`,
  `OPENCLAW_WORKSPACES_HOST_PATH`; thêm `N8N_DATA_HOST_PATH` chỉ khi bật n8n.
- Release control plane: `RELEASE_EVIDENCE_FILE`, `RELEASE_EVIDENCE_SHA256`,
  `SECRET_ROTATION_PROOF_REFERENCE` và `SECRET_ROTATION_PROOF_SHA256`. Các file
  evidence/proof phải nằm ngoài checkout và chỉ chứa reference, không chứa secret.
- Theo feature bật: Firebase mount, Telegram, image/search, Firecrawl, GHTK,
  SMTP, payment, storage và VAPID credentials.

Legacy `API_KEY` và các alias key cũ bị deploy preflight từ chối.

## Blocker bắt buộc trước production

1. Thu hồi/xoay credential đã lộ; xác minh caller-scoped key mới trong secret
   store; xử lý local trace/backup theo
   `deploy/SECRET_REMEDIATION_RUNBOOK.md`. Proof chỉ chứa immutable reference,
   được kiểm bằng `.github/scripts/validate-secret-rotation-proof.mjs`, và nằm
   ngoài checkout.
2. Chọn chiến lược xử lý lịch sử Git dùng chung sau khi khóa cũ đã chết; full
   Gitleaks phải trả 0 hoặc có quyết định security-reviewed rõ ràng.
3. Review và commit toàn bộ thay đổi release; CI phải chạy trên commit sạch.
4. Cấp image version+digest đã duyệt; chạy build và scan backend/frontend cùng
   Redis/nginx/Certbot/OpenClaw, và n8n nếu bật. Không chấp nhận high/critical.
5. Trên staging DB riêng: backup, restore drill, migration dry-run, apply có xác
   nhận và verify index manifest.
6. Chạy canary regeneration với `draftOnly=true`, `autoPublish=false`; xác nhận
   `queued → running → completed/no_change`, evidence thật và topic đạt
   tối thiểu 82/48 mà không tạo bài published.
7. Hoàn thiện TLS SAN, candidate slot/traffic switch, rollback và smoke test.
   Deploy script hiện cố ý dừng tại `SAFE_RELEASE_TOPOLOGY_REQUIRED`.
8. Tạo manifest `inoxpran-release-evidence-v1` thật, gắn đúng release commit,
   staging database identity, scan và smoke artifacts; kiểm bằng validator
   read-only trước khi cân nhắc production.

## Dư lượng cục bộ

MongoDB test package đã xác minh checksum vẫn nằm tại
`C:\Users\Admin\AppData\Local\Temp\inoxpran-mongo-7.0.16` vì cleanup bị execution
policy chặn. Không còn process/listener Mongo; thư mục chỉ chứa archive, binary,
log và database test cô lập, không chứa dữ liệu người dùng. Operator có thể xóa
thủ công sau khi xác nhận không cần tái chạy integration test.

Dữ liệu của lần integration cuối nằm tại
`C:\Users\Admin\AppData\Local\Temp\inoxpran-final-mongo-20260729`; process và
listener `27020` đã dừng, nhưng thao tác xóa chính xác thư mục này cũng bị
execution policy chặn. Đây chỉ là database/log test cô lập, không phải dữ liệu
production.

Lần xác minh Redis cuối dùng database Mongo cô lập tại
`C:\Users\Admin\AppData\Local\Temp\inoxpran-redis-fix-mongo-20260730` trên cổng
`27021`. Process và listener đã dừng sau khi hoàn tất 889 test; thư mục còn lại
chỉ chứa database/log test, không phải dữ liệu production.

Gitleaks 8.30.1 checksum-verified dùng cho lần quét cuối còn tại
`C:\Users\Admin\AppData\Local\Temp\inoxpran-gitleaks-7fe7aa9e9efd473b868d7c8cdb9a8c0b`
vì cleanup chính xác cũng bị execution policy chặn. Thư mục chỉ chứa binary,
archive và checksum công khai; metadata report tạm đã được wrapper tự xóa.

Tham chiếu vận hành:

- `deploy/PRODUCTION_RELEASE_RUNBOOK.md`
- `deploy/RELEASE_EVIDENCE.md`
- `deploy/SECRET_REMEDIATION_RUNBOOK.md`
- `.github/workflows/ci.yml`
- `DEPENDENCY_SECURITY.md`

## Cập nhật sự cố dữ liệu frontend 2026-07-30

Quyết định release vẫn là **BLOCKED**; local runtime đã phục hồi nhưng chưa được
phép triển khai production.

- Nguyên nhân: Vite chạy trực tiếp trên Windows dùng nhầm hostname nội bộ Compose
  `backend`, nên product/blog request dừng ở DNS với `ENOTFOUND` trước khi tới API.
- Khắc phục: local root API base dùng loopback; Vite host-development tự chuyển
  hostname Docker-only về loopback. Compose vẫn inject service hostname riêng.
- Home-feed hiện fail-closed: malformed HTTP 200 không còn được coi là loaded,
  cả product và blog source đều phải có schema hợp lệ; upstream failure trả 502
  cùng `HOME_FEED_UPSTREAM_UNAVAILABLE` thay vì HTTP 200 giả.
- Admin products không còn coi `metadata: {}` là danh sách rỗng hợp lệ.
- Real-app mock backend không còn catch-all 200; route chưa khai báo trả 404.
  E2E bắt buộc thấy product/blog fixture thật và một hàng admin product có session.
- Vite optimizer dùng inline sourcemap trong cache dev mới: 50 optimized JS,
  0 external map reference, 0 SSR eager-fetch false-positive và 0 stderr runtime.

Gate đã chạy lại sau bản vá:

- Backend: 886 pass, 3 skip theo điều kiện integration; syntax 321/321.
- Mongo integration cô lập: 3/3 pass; database test được drop sau khi hoàn tất.
- Frontend unit: 134/134 pass.
- Playwright module-browser: 6/6 pass.
- Playwright real-app: 7/7 pass, gồm `/`, `/en`, `/admin/products`, 202/502/504,
  recovery, polling; `forbiddenPublishCalls` luôn rỗng.
- Prettier/ESLint: 0 lỗi; production build: pass, không cảnh báo Svelte/a11y/chunk.
- Dependency audit backend/frontend: 0 vulnerability.
- Compose render: pass với placeholder non-secret cho toàn bộ required input.
- Runtime thật: backend live/ready 200, Mongo `ready`, Redis
  `disabled_optional`; home-feed 200 với 6 product và 4 post; `/`, `/en`,
  `/shop`, `/blog` đều 200; Chrome session thật thấy 10 admin product và 0 alert.

Blocker cấu hình production chưa được cấp qua secret store:

- `PUBLIC_API_KEY`, `USER_API_KEY`, `ADMIN_BFF_API_KEY`,
  `OPENCLAW_INTERNAL_API_KEY`, `ADMIN_BASE_URL` và `REDIS_PASSWORD`/Redis TLS.
- Không gửi giá trị vào chat. Local hiện vẫn dùng legacy API key fallback và Redis
  tắt có chủ đích; cả hai trạng thái đều không đạt production readiness.

## Cập nhật phục hồi OpenClaw Blog 2026-07-30

Local runtime hiện **RUNNABLE**; quyết định production vẫn là **BLOCKED** cho tới
khi hoàn tất các blocker bảo mật và hạ tầng ở trên.

- Nguyên nhân lỗi quan trọng nhất: agent đã persist blog draft thành công nhưng
  lease của Content Work Order hết hạn ngay sau commit. Nhánh catch của scheduler
  cũ đánh dấu execution thất bại mà không đối soát commit vừa lưu, tạo false
  failure `CONTENT_WORK_ORDER_LEASE_LOST`.
- Scheduler hiện chỉ phục hồi khi tìm thấy đúng blog commit khớp đồng thời
  execution ID, Work Order ID, source và trạng thái draft-only. Commit lệch hoặc
  thiếu bằng chứng tiếp tục fail-closed; không có fallback đoán thành công.
- Sau khi blog đã được xác minh, execution, Work Order, roadmap item và schedule
  được reconcile bằng compare-and-set. Không tạo bài thứ hai và không publish.
- Bản nháp canary thật:
  `6a6aed9d487fe5ff5251c721`,
  “Ấm siêu tốc mới có mùi nhựa: cách kiểm tra trước khi dùng tiếp”,
  `isDraft=true`, `isPublished=false`, `publishedAt=null`.
- Execution `6a6aecc0487fe5ff5251c262` hiện là `draft_created`; schedule
  `6a6ad29d6f46a5b79cdaeddd` vẫn `draftOnly=true`, `autoPublish=false`.
- Backend runtime PID 8068 đang listen cổng 3056; live/ready đều 200, MongoDB
  `ready`, Redis `disabled_optional`. Log sau restart có 0 Redis client error,
  0 HTTP 500 và 0 lease-lost mới.

Gate chạy lại sau bản vá OpenClaw:

- Backend capability/dashboard target: 103/103 pass; full suite: 923 pass,
  3 conditional skip, 0 fail;
  syntax: 321/321.
- Frontend: Prettier 0 lệch, ESLint 0 lỗi, unit 134/134, production build pass
  và không có cảnh báo Svelte/a11y/chunk.
- Playwright: module-browser 6/6, real-app 7/7, tổng 13/13.
- Security/release contract: 27/27; dependency audit backend/frontend: 0
  vulnerability; CI safety contract pass và không có publish/deploy mutation.
- Gitleaks 8.30.1: current source 0; full history 55 finding trên 19 file/28
  commit; local ignored artifacts 82 finding trên 12 file. Không có raw finding
  hoặc secret nào được xuất.
- Mongo integration đã chạy lại 3/3 trên database Atlas có tên cô lập ngẫu
  nhiên và đã drop sau test. Manifest tạo/verify 10 index; lần apply thứ hai tạo
  0 index, xác nhận idempotent. Không chạm database ứng dụng.
- Production container invocation bị chặn đúng thiết kế vì chưa cấp
  `REDIS_IMAGE`, `NGINX_IMAGE`, `CERTBOT_IMAGE`, `OPENCLAW_IMAGE` và reviewed
  `NODE_RUNTIME_IMAGE`; Docker Desktop daemon cũng chưa hoạt động. Local Compose
  validation vẫn pass.

## Cập nhật capability và CI 2026-07-30

- Chrome session đăng nhập thật xác nhận BOS hiển thị
  `Chặn / suy giảm: Không có`. Blog Cron, Google Intelligence, Gateway,
  Inventory và Automation API đều `Tốt`.
- Blog Cron tách lịch chạy kế tiếp khỏi execution thành công gần nhất; thời điểm
  thành công hiện hiển thị đúng 13:36 thay vì lấy nhầm 11:26 từ lịch khác.
- Telegram local đã được đặt `TELEGRAM_BOT_ENABLED=false` vì chưa có
  `ADMIN_BASE_URL` HTTPS; dashboard hiển thị `Tắt theo thiết kế`, không còn
  blocker đỏ. Không thay đổi token hoặc allowlist.
- Image pipeline chọn Blog agentic artifact mới nhất khi execution metadata bị
  thiếu. Canary hiện có 3 ảnh, 2 ảnh chờ duyệt nên trạng thái là
  `manual_review / image_approval_required` trung tính, không phải xanh và không
  phải suy giảm. Thông điệp VI/EN giải thích rõ đây không phải lỗi pipeline.
- Post-commit recovery hiện copy `imagePipelineStatus` đã kiểm tra enum sang
  execution metadata. Execution canary hiện đã được backfill bằng compare-and-set
  khớp execution/blog/status; không thay đổi outcome hoặc publication state.
- Root `.env` local đã khóa rõ các invariant:
  `SEO_AGENT_AUTO_PUBLISH=false`,
  `INOXPRAN_SEO_AGENT_AUTO_PUBLISH=false`,
  `AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH=false`,
  `CONTENT_LEARNING_AUTO_APPLY=false`,
  `OPENCLAW_UPDATE_ENABLED=false`,
  `OPENCLAW_NO_AUTO_UPDATE=1`.
- CI checkout sạch tạo `.env` tạm từ `.env.example` trước khi render local
  Compose; safety validator khóa thứ tự này. Ví dụ image trong tài liệu deploy
  bắt buộc version tag và SHA-256 digest, không dùng `latest` hoặc digest giả.
- Gate cuối: backend 923 pass/3 skip, frontend 134/134, Playwright 13/13,
  security/release 27/27, Gitleaks current source 0/1.065 input,
  `git diff --check` pass. Runtime mới có 0 Redis error, 0 HTTP 500 và 0
  `CONTENT_WORK_ORDER_LEASE_LOST`.
