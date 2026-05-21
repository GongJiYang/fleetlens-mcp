# Changelog

## 0.9.1 - 2026-05-21

- Hardened seed reconciliation so user-edited demo dashboards are preserved across updates instead of being overwritten by repo seeds.
- Added an optional Luminon tool-policy skill for Codex and documented how Claude CLI and Gemini CLI can reuse the same policy text.
- Documented the agent usage flow in `docs/MCP_DOCUMENTATION.md` and clarified how to install or reuse the policy for different clients.
- Kept the 0.9.x release line focused on compatibility and non-destructive behavior rather than feature-surface changes.

## 0.9.0 - 2026-05-20

- Added dual runtime flow for local and remote MCP operation without breaking stdio usage:
  - `luminon mcp` for local stdio (AI client managed).
  - `luminon start` keeps launching the local renderer.
  - `luminon start remote` launches the HTTP MCP server.
- Added CLI token lifecycle for remote MCP bearer auth (`token create/list/delete/current`) with encrypted-at-rest storage in local user data.
- Added remote MCP auth enforcement and operational defaults, including startup behavior when no token exists and token fallback when deleting the current token.
- Added dashboard information architecture primitives and tools for OSS/commercial parity:
  - multi-page dashboards (create/list/import/copy/move flows),
  - dashboard groups,
  - dashboard folders.
- Added natural-language coverage in dashboard NL flows for pages/groups/folders operations to keep tool behavior consistent across OSS and commercial runtimes.
- Added secure renderer sharing via share links:
  - create/list/revoke links,
  - optional passcode protection,
  - passcode rotation/removal,
  - basic shared endpoint rate limiting.
- Added renderer sidebar group navigation with scalable behavior for many groups:
  - top pinned groups,
  - overflow `More` menu with group search,
  - mobile selector,
  - persisted selected group filter.
- Improved shared-link UX and security behavior:
  - `/shared/:token` validates passcode then redirects to the visual dashboard route,
  - passcode is no longer exposed in redirected URL (session storage bridge),
  - automatic fallback to passcode prompt when session context is missing.
- Updated dashboard header actions to prioritize secure sharing:
  - removed `Private/Published` toggle and `Copy public URL` from primary OSS UI,
  - kept backend compatibility for legacy `published` semantics.
- Expanded renderer and integration tests around sharing/passcode/revoke/rate-limit flows and fixed flaky sequencing that previously produced `429` in passcode lifecycle tests.

## 0.2.0 - 2026-05-11

- Added `organizationId` to the shared request context so the remote MCP runtime can carry commercial workspace metadata.
- Added streamable HTTP MCP support with optional bearer-token auth for remote deployments.
- Moved themes, templates, and chart metadata behind a local content registry.
- Decoupled the local workspace storage behind an injectable backend seam.
- Updated the renderer quickstart to use the current `mcp` entrypoint and optional tool modes.
- Improved shared-dashboard loading with `?page=` support in the renderer.
- Hardened renderer chart rendering for empty tables, KPIs, and grouped/stacked bar key resolution.

## 0.1.3

- Initial public package release state used as the last published baseline for this changelog.
