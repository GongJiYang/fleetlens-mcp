# Changelog

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
