# Luminon OSS Starting Point

The OSS repo should keep evolving on its own, without treating the commercial repo as the source of truth.

Current OSS assumptions:
- JSON-based persistence
- no plane
- no database
- no internal scheduling/worker dependency for core features

Recommended direction:
- keep a shared dashboard artifact model: pages, page order, folders, share tokens, refresh scripts
- reuse domain logic when possible: normalization, validation, active page resolution, rendering
- implement OSS-specific storage as JSON/filesystem adapters
- expose secure sharing with signed tokens and remote renderer validation
- expose refresh as REST/SSE so developers can use their own cron jobs externally

Rule of thumb:
- belongs in OSS if it depends on dashboard artifacts, sharing, or request-driven refresh
- stays commercial if it depends on plane, DB, workers, RBAC, or alert delivery
