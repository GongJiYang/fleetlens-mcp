---
name: luminon-tool-policy
description: Strict non-destructive operating policy for Luminon MCP dashboard tasks. Use when a client is about to swap, move, copy, import, or otherwise mutate dashboards, pages, charts, groups, folders, or sharing state.
---

# Luminon Tool Policy

Use this skill when working with the Luminon MCP server or renderer through Codex, Claude, Gemini, or any other LLM client.

## Purpose

Keep dashboard edits minimal, verifiable, and non-destructive. Prefer direct tools over free-form natural language when an atomic tool exists.

## Rules

1. Never recreate a dashboard to satisfy a layout-only request.
2. Never delete charts or dashboards unless the user explicitly requests deletion and confirms it.
3. For swaps, use `swap_chart_positions`.
4. For moving a chart between pages, use `move_chart_to_page`.
5. For page copying/import, use the dedicated page tools.
6. For group and folder operations, use the explicit group/folder tools.
7. For layout changes, mutate only the requested items and preserve `id`, `w`, and `h` unless the user explicitly asks otherwise.
8. If a request is ambiguous, stop and ask for clearer chart or dashboard identifiers.

## Required Verification

Before responding about any layout mutation:

1. Resolve the target dashboard and chart identities.
2. Apply the smallest possible tool call.
3. Report before/after `x`, `y`, `w`, `h` for each affected chart.
4. Confirm that no chart or dashboard was created or deleted unless that was the requested action.

## Hard Stops

Abort and ask for clarification if:

- Chart names are ambiguous.
- The charts are not on the same page for a swap.
- The requested change would require destructive tools to approximate.
- A client asks for a page/dashboard rebuild when a direct mutation is available.

## Recommended Workflow

1. Read the current dashboard state.
2. Prefer the most atomic tool available.
3. Verify the persisted result.
4. Only then summarize the outcome to the user.

## Companion Policy

If you are using this skill inside the Luminon repository, also consult `docs/LLM_TOOL_POLICY.md` for the longer vendor-neutral reference.
