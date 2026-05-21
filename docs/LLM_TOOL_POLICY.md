# LLM Tool Policy (Strict)

This policy is intended for AI clients (Gemini CLI, Codex, Claude, etc.) that control the Luminon MCP server.

## Goal

Prevent destructive behavior for simple dashboard edits and enforce minimal, verifiable tool usage.

## Non-Destructive Rules

1. Never recreate a dashboard to satisfy a layout-only request.
2. Never delete charts/dashboards unless the user explicitly asks for deletion and explicit confirmation is present.
3. For position-only changes, mutate only layout coordinates of the requested charts.
4. Keep chart identity (`id`) and chart content unchanged for layout-only requests.

## Required Tool Selection

Use direct tools first. Do not prefer `dashboard_nl` when an atomic tool exists.

- For swapping two chart positions:
  - Use `swap_chart_positions`.
  - Do not use `delete_chart`, `create_chart`, `delete_dashboard`, or full `update_dashboard(layout=...)` reconstruction.
- For moving one chart between pages:
  - Use `move_chart_to_page`.
- For copying/importing pages:
  - Use `copy_dashboard_page` / `import_dashboard_pages`.
- For groups/folders:
  - Use explicit group/folder tools.

## Verification Before Responding

For any layout mutation:

1. Read/resolve target dashboard and charts.
2. Apply only the minimal tool call.
3. Return a before/after summary:
   - chart id/title
   - `x`, `y`, `w`, `h`
4. If resolution fails for either chart, fail safely and ask for clearer chart identifiers.

## Hard Failure Conditions

Abort the operation (do not improvise) if:

- Requested chart names are ambiguous.
- Charts are not found in the target dashboard.
- The requested operation would require destructive tools to approximate behavior.

## Example (Swap)

User intent: "Swap chart A and chart B in dashboard X"

Expected behavior:

1. Resolve dashboard X.
2. Call `swap_chart_positions` with `dashboardId`, `chartA`, `chartB`.
3. Report before/after coordinates.
4. Confirm no chart was created/deleted.

## How to Use This Policy

### Codex

- Optional skill location in this repo: `skills/luminon-tool-policy/`
- Copy it into `~/.codex/skills/luminon-tool-policy` to make it available locally
- Restart Codex after installing the skill

### Claude CLI

- Paste this policy into project instructions or prepend it to the prompt when working on Luminon tasks
- Prefer the atomic tools listed above when a direct tool exists

### Gemini CLI

- Use this policy as a persistent prompt block or session instruction
- Do not let the client reconstruct dashboards when an atomic mutation is available
