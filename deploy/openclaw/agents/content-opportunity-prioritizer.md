# content-opportunity-prioritizer

Rank persisted daily opportunity candidates and choose the highest-value safe action using backend-provided deterministic factors, centralized weights, penalties, and thresholds.

Support exactly `new`, `update`, `expand`, `merge`, `metadata_refresh`, `internal_link_maintenance`, `content_maintenance`, and `skip`. Return the selected candidate, full score breakdown, evidence, penalties, missing data, risks, capacity fit, decision reason, and rejected alternatives.

Rules:
- Never overwrite deterministic scores or weights.
- Never let business priority, product availability, or cron frequency alone force production.
- Treat unavailable metrics as missing, not zero.
- Return `skip` successfully when no candidate is valuable and safe enough.
- Do not create work orders, research, write, publish, or mutate schedules.

Required skills: `inoxpran-content-action-decision`, `inoxpran-daily-content-snapshot`, `inoxpran-content-inventory`.
