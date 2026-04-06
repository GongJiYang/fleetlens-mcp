import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  addChartInputSchema,
  addChartToDashboardInputSchema,
  createChartFromDatasetInputSchema,
  createDashboardInputSchema,
  createDashboardFromTemplateInputSchema,
  dashboardNlInputSchema,
  deleteDashboardInputSchema,
  deleteChartInputSchema,
  describeDatasetInputSchema,
  listDatasetContentInputSchema,
  listDashboardsInputSchema,
  registerDatasetInputSchema,
  updateDatasetInputSchema,
  setChartPresentationInputSchema,
  setChartThemeInputSchema,
  updateDashboardInputSchema,
  updateDashboardFiltersInputSchema,
  resetChartPresentationInputSchema,
  listDashboardFiltersInputSchema,
  createSnapshotInputSchema,
  listDashboardVersionsInputSchema,
  restoreDashboardVersionInputSchema,
  undoDashboardInputSchema,
  restoreDeletedDashboardInputSchema,
  restoreDatasetSnapshotInputSchema,
  type Chart,
  type Dashboard,
  type DashboardFilter,
  type DashboardSnapshot,
  type Dataset
} from "../../shared/dist/index.js";
import {
  allowAllPolicyAdapter,
  createScopePolicyAdapter,
  isWorkspaceRole,
  type ContextSource,
  type PolicyAction,
  type PolicyAdapter,
  type PolicyResource,
  type RequestContext,
  type WorkspaceDataBackend
} from "../../core/dist/index.js";
import { localWorkspaceStorage } from "./local-workspace-storage.js";

export type ToolMode = "full" | "lite" | "ultra-lite";
type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type RequestSource = Extract<ContextSource, "local_cli" | "remote_mcp">;

export function resolveToolMode(raw: string | undefined): ToolMode {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "lite") return "lite";
  if (normalized === "ultra-lite" || normalized === "ultralite" || normalized === "ultra_lite") {
    return "ultra-lite";
  }
  return "full";
}

const LITE_TOOLS = new Set([
  "create_dashboard",
  "update_dashboard",
  "delete_dashboard",
  "list_dashboards",
  "list_templates",
  "create_dashboard_from_template",
  "dashboard_nl",
  "register_dataset",
  "update_dataset",
  "restore_dataset_snapshot",
  "list_datasets",
  "list_dataset_content",
  "describe_dataset",
  "create_chart",
  "list_dashboard_filters",
  "update_dashboard_filters"
]);

const ULTRA_LITE_TOOLS = new Set([
  "create_dashboard",
  "list_dashboards",
  "list_templates",
  "create_dashboard_from_template",
  "register_dataset",
  "list_datasets",
  "describe_dataset",
  "list_dataset_content",
  "create_chart",
  "list_dashboard_filters",
  "update_dashboard_filters"
]);

function toolEnabled(name: string, toolMode: ToolMode): boolean {
  if (toolMode === "full") return true;
  if (toolMode === "lite") return LITE_TOOLS.has(name);
  return ULTRA_LITE_TOOLS.has(name);
}

function toTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? "").length))
  );
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join("-|-");
  return [line(headers), separator, ...rows.map((row) => line(row))].join("\n");
}

function textResponse(text: string) {
  return {
    content: [{ type: "text" as const, text }]
  };
}

function jsonResponse(value: unknown) {
  return textResponse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function looksLikeDashboard(value: unknown): value is Dashboard {
  return isRecord(value) && typeof value.id === "string" && Array.isArray(value.charts) && isRecord(value.layout);
}

function looksLikeDataset(value: unknown): value is Dataset {
  return isRecord(value) && typeof value.id === "string" && Array.isArray(value.columns) && Array.isArray(value.rows);
}

function looksLikeSnapshot(value: unknown): value is DashboardSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.dashboardId === "string" &&
    typeof value.createdAt === "string" &&
    "payload" in value
  );
}

function summarizeChart(chart: Chart | undefined) {
  if (!chart) return undefined;
  return {
    id: chart.id,
    type: chart.type,
    title: chart.title,
    datasetId: chart.datasetId
  };
}

function summarizeDashboard(dashboard: Dashboard) {
  return {
    id: dashboard.id,
    name: dashboard.name,
    subtitle: dashboard.subtitle,
    themePreset: dashboard.themePreset,
    published: dashboard.published,
    chartCount: dashboard.charts.length,
    filterCount: (dashboard.filters ?? []).length,
    layout: {
      columns: dashboard.layout.grid.columns,
      rows: dashboard.layout.grid.rows
    },
    updatedAt: dashboard.updatedAt,
    lastChart: summarizeChart(dashboard.charts.at(-1))
  };
}

function summarizeDataset(dataset: Dataset) {
  return {
    id: dataset.id,
    name: dataset.name,
    columns: dataset.columns,
    columnCount: dataset.columns.length,
    rowCount: dataset.rows.length,
    readOnly: Boolean(dataset.readOnly),
    updatedAt: dataset.updatedAt
  };
}

function summarizeSnapshot(snapshot: DashboardSnapshot) {
  return {
    id: snapshot.id,
    dashboardId: snapshot.dashboardId,
    createdAt: snapshot.createdAt,
    comment: snapshot.comment ?? ""
  };
}

function summarizeFilter(filter: DashboardFilter) {
  return {
    id: filter.id,
    field: filter.field,
    fieldType: filter.fieldType,
    op: filter.op,
    value: filter.value,
    valueTo: filter.valueTo,
    applyTo: filter.applyTo
  };
}

function summarizeUnknownResult(result: unknown): unknown {
  if (result === null || result === undefined) return result;

  if (Array.isArray(result)) {
    return result.slice(0, 20).map((item) => summarizeUnknownResult(item));
  }

  if (looksLikeDashboard(result)) return summarizeDashboard(result);
  if (looksLikeDataset(result)) return summarizeDataset(result);
  if (looksLikeSnapshot(result)) return summarizeSnapshot(result);

  if (isRecord(result) && Array.isArray(result.filters)) {
    return {
      filterCount: result.filters.length,
      filters: result.filters.slice(0, 20).map((filter) =>
        summarizeFilter(filter as DashboardFilter)
      )
    };
  }

  return result;
}

function dashboardResponse(dashboard: Dashboard, extra?: Record<string, unknown>) {
  return jsonResponse({
    ok: true,
    dashboard: summarizeDashboard(dashboard),
    ...extra
  });
}

function datasetResponse(dataset: Dataset, extra?: Record<string, unknown>) {
  return jsonResponse({
    ok: true,
    dataset: summarizeDataset(dataset),
    ...extra
  });
}

function datasetValueToString(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function filtersTable(filters: DashboardFilter[]): string {
  if (filters.length === 0) return "No active filters.";
  return toTable(
    ["id", "field", "type", "op", "value", "valueTo", "applyTo"],
    filters.map((filter) => [
      filter.id,
      filter.field,
      filter.fieldType,
      filter.op,
      datasetValueToString(filter.value),
      datasetValueToString(filter.valueTo),
      (filter.applyTo ?? []).join(", ")
    ])
  );
}

function readAuthExtra(extra: ToolExtra, key: string): unknown {
  return extra.authInfo?.extra?.[key];
}

function requestContextFromExtra(extra: ToolExtra, requestSource: RequestSource): RequestContext {
  const roleValue = readAuthExtra(extra, "role");
  const principalFromExtra = readAuthExtra(extra, "principalId");
  const workspaceFromExtra = readAuthExtra(extra, "workspaceId");
  const licenseTierFromExtra = readAuthExtra(extra, "licenseTier");

  return {
    source: requestSource,
    principalId:
      typeof principalFromExtra === "string" && principalFromExtra.trim().length > 0
        ? principalFromExtra
        : extra.authInfo?.clientId,
    workspaceId:
      typeof workspaceFromExtra === "string" && workspaceFromExtra.trim().length > 0
        ? workspaceFromExtra
        : requestSource === "local_cli"
        ? "local"
        : undefined,
    role: isWorkspaceRole(roleValue)
      ? roleValue
      : requestSource === "local_cli"
      ? "owner"
      : "viewer",
    licenseTier: typeof licenseTierFromExtra === "string" ? licenseTierFromExtra : undefined,
    scopes: extra.authInfo?.scopes
  };
}

async function authorizeRequest(
  policyAdapter: PolicyAdapter,
  action: PolicyAction,
  resource: PolicyResource,
  extra: ToolExtra,
  options: { enforcePolicy: boolean; requestSource: RequestSource }
): Promise<RequestContext> {
  if (options.enforcePolicy && !extra.authInfo) {
    throw new Error("Unauthorized");
  }

  const context = requestContextFromExtra(extra, options.requestSource);
  if (!options.enforcePolicy) {
    return context;
  }

  const decision = await policyAdapter.authorize({
    action,
    resource,
    context
  });

  if (!decision.allowed) {
    throw new Error(decision.reason ?? `Forbidden: ${action}`);
  }

  return context;
}

function applyCreationContext<T extends { workspaceId?: string; createdBy?: string }>(
  input: T,
  context: RequestContext
): T {
  return {
    ...input,
    workspaceId: input.workspaceId ?? context.workspaceId,
    createdBy: input.createdBy ?? context.principalId
  };
}

export function toolCountForMode(toolMode: ToolMode): number | "all" {
  if (toolMode === "full") return "all";
  if (toolMode === "lite") return LITE_TOOLS.size;
  return ULTRA_LITE_TOOLS.size;
}

export function formatToolModeStartupMessage(toolMode: ToolMode): string {
  const count = toolCountForMode(toolMode);
  return `mcp-dashboard starting in ${toolMode} mode (${count} tools exposed)`;
}

export function createLuminonMcpServer(options?: {
  toolMode?: ToolMode;
  requestSource?: RequestSource;
  policyAdapter?: PolicyAdapter;
  enforcePolicy?: boolean;
  backend?: WorkspaceDataBackend;
}): McpServer {
  const toolMode = options?.toolMode ?? resolveToolMode(process.env.LUMINON_MCP_MODE);
  const requestSource = options?.requestSource ?? "local_cli";
  const enforcePolicy = options?.enforcePolicy ?? false;
  const policyAdapter = options?.policyAdapter ?? (enforcePolicy ? createScopePolicyAdapter() : allowAllPolicyAdapter);
  const backend = options?.backend ?? localWorkspaceStorage;
  const server = new McpServer({
    name: "mcp-dashboard",
    version: "0.2.0"
  });

  if (toolEnabled("create_dashboard", toolMode)) {
    server.tool(
      "create_dashboard",
      "Create a dashboard. If layout is omitted, default grid 3x3 is used.",
      {
        input: createDashboardInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", workspaceId: input.workspaceId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.createDashboard(applyCreationContext(input, context), context);
        return dashboardResponse(dashboard);
      }
    );
  }

  if (toolEnabled("update_dashboard", toolMode)) {
    server.tool(
      "update_dashboard",
      "Update dashboard properties (name, subtitle, theme, presentation, columns, layout, autoLayout).",
      {
        input: updateDashboardInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.updateDashboard(input, context);
        return dashboardResponse(dashboard);
      }
    );
  }

  if (toolEnabled("add_chart", toolMode)) {
    server.tool(
      "add_chart",
      "Add a chart payload to an existing dashboard (without automatic layout placement).",
      {
        input: addChartInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.addChart(input, context);
        return dashboardResponse(dashboard, { chart: summarizeChart(input.chart) });
      }
    );
  }

  if (toolEnabled("add_chart_to_dashboard", toolMode)) {
    server.tool(
      "add_chart_to_dashboard",
      "Add chart to dashboard id with automatic default grid placement; optional grid/placement overrides.",
      {
        input: addChartToDashboardInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.addChartToDashboard(input, context);
        return dashboardResponse(dashboard, { chart: summarizeChart(input.chart) });
      }
    );
  }

  if (toolEnabled("delete_chart", toolMode)) {
    server.tool(
      "delete_chart",
      "Delete a chart from dashboard and remove it from layout. Requires confirm: \"DELETE\".",
      {
        input: deleteChartInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.deleteChart(input, context);
        return dashboardResponse(dashboard, { deletedChartId: input.chartId });
      }
    );
  }

  if (toolEnabled("delete_dashboard", toolMode)) {
    server.tool(
      "delete_dashboard",
      "Delete a dashboard by id. Requires confirm: \"DELETE\".",
      {
        input: deleteDashboardInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const result = await backend.deleteDashboard(input, context);
        return jsonResponse({ ok: true, ...result });
      }
    );
  }

  if (toolEnabled("list_dashboards", toolMode)) {
    server.tool(
      "list_dashboards",
      "List dashboards with status filter: active|deleted|all.",
      {
        input: listDashboardsInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.read",
          { kind: "dashboard" },
          extra,
          { enforcePolicy, requestSource }
        );
        const { dashboards } = await backend.listDashboardsFiltered(input, context);
        const rows = dashboards.map((dashboard) => {
          if ("payload" in dashboard) {
            return [
              dashboard.id,
              dashboard.name,
              String(dashboard.payload.charts.length),
              dashboard.deletedAt,
              "deleted"
            ];
          }
          return [
            dashboard.id,
            dashboard.name,
            String(dashboard.charts.length),
            dashboard.updatedAt,
            "active"
          ];
        });
        return textResponse(toTable(["id", "name", "charts", "timestamp", "status"], rows));
      }
    );
  }

  if (toolEnabled("list_theme_presets", toolMode)) {
    server.tool("list_theme_presets", "List available chart theme presets.", async (extra) => {
      const context = await authorizeRequest(
        policyAdapter,
        "content.read",
        { kind: "content" },
        extra,
        { enforcePolicy, requestSource }
      );
      const themes = await backend.listThemePresets(context);
      const table = toTable(
        ["theme", "description"],
        themes.map((theme) => [theme.id, theme.description])
      );
      return textResponse(table);
    });
  }

  if (toolEnabled("list_templates", toolMode)) {
    server.tool("list_templates", "List built-in dashboard templates and their default datasets.", async (extra) => {
      const context = await authorizeRequest(
        policyAdapter,
        "content.read",
        { kind: "content" },
        extra,
        { enforcePolicy, requestSource }
      );
      const templates = await backend.listTemplates(context);
      const table = toTable(
        ["id", "name", "dataset", "charts", "filters"],
        templates.map((template) => [
          template.id,
          template.name,
          template.defaultDatasetId,
          template.charts.map((chart) => chart.type).join(", "),
          template.filters.map((filter) => filter.field).join(", ")
        ])
      );
      return textResponse(table);
    });
  }

  if (toolEnabled("snapshot_dashboard", toolMode)) {
    server.tool(
      "snapshot_dashboard",
      "Create/overwrite the single snapshot for a dashboard (keeps only latest).",
      {
        input: createSnapshotInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const snapshot = await backend.snapshotDashboard(input, context);
        return jsonResponse({ ok: true, snapshot: summarizeSnapshot(snapshot) });
      }
    );
  }

  if (toolEnabled("list_dashboard_versions", toolMode)) {
    server.tool(
      "list_dashboard_versions",
      "List the current snapshot for a dashboard (single snapshot stored).",
      {
        input: listDashboardVersionsInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.read",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const snapshots = await backend.listDashboardVersions(input, context);
        const table = toTable(
          ["snapshotId", "createdAt", "comment"],
          snapshots.map((snapshot) => [snapshot.id, snapshot.createdAt, snapshot.comment ?? ""])
        );
        return textResponse(table);
      }
    );
  }

  if (toolEnabled("restore_dashboard_version", toolMode)) {
    server.tool(
      "restore_dashboard_version",
      "Restore a dashboard from its snapshot (optionally rename).",
      {
        input: restoreDashboardVersionInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.restoreDashboardVersion(input, context);
        return dashboardResponse(dashboard);
      }
    );
  }

  if (toolEnabled("undo_dashboard", toolMode)) {
    server.tool(
      "undo_dashboard",
      "Undo to the latest snapshot of a dashboard.",
      {
        input: undoDashboardInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.undoDashboard(input, context);
        return dashboardResponse(dashboard);
      }
    );
  }

  if (toolEnabled("restore_deleted_dashboard", toolMode)) {
    server.tool(
      "restore_deleted_dashboard",
      "Restore a deleted dashboard (optionally with new id/name).",
      {
        input: restoreDeletedDashboardInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.restoreDeletedDashboard(input, context);
        return dashboardResponse(dashboard);
      }
    );
  }

  if (toolEnabled("create_dashboard_from_template", toolMode)) {
    server.tool(
      "create_dashboard_from_template",
      "Instantiate a dashboard from a built-in template (use template_id + optional dataset_id).",
      {
        input: createDashboardFromTemplateInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", workspaceId: input.workspaceId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.createDashboardFromTemplate(applyCreationContext(input, context), context);
        return dashboardResponse(dashboard);
      }
    );
  }

  if (toolEnabled("dashboard_nl", toolMode)) {
    server.tool(
      "dashboard_nl",
      "Natural-language dashboard assistant. Use this tool so users do not need to know technical MCP tool names.",
      {
        input: dashboardNlInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", workspaceId: input.workspaceId },
          extra,
          { enforcePolicy, requestSource }
        );
        const result = await backend.dashboardNl(applyCreationContext(input, context), context);
        return jsonResponse({
          ok: true,
          action: result.action,
          message: result.message,
          result: summarizeUnknownResult(result.result)
        });
      }
    );
  }

  if (toolEnabled("set_chart_theme", toolMode)) {
    server.tool(
      "set_chart_theme",
      "Set theme preset for one chart inside a dashboard.",
      {
        input: setChartThemeInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.setChartTheme(input, context);
        return dashboardResponse(dashboard, { chartId: input.chartId, themePreset: input.themePreset });
      }
    );
  }

  if (toolEnabled("set_chart_presentation", toolMode)) {
    server.tool(
      "set_chart_presentation",
      "Set chart-specific presentation override for one chart inside a dashboard.",
      {
        input: setChartPresentationInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.setChartPresentation(input, context);
        return dashboardResponse(dashboard, { chartId: input.chartId });
      }
    );
  }

  if (toolEnabled("reset_chart_presentation", toolMode)) {
    server.tool(
      "reset_chart_presentation",
      "Remove chart-specific presentation override from one chart.",
      {
        input: resetChartPresentationInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.resetChartPresentation(input, context);
        return dashboardResponse(dashboard, { chartId: input.chartId });
      }
    );
  }

  if (toolEnabled("register_dataset", toolMode)) {
    server.tool(
      "register_dataset",
      "Register a dataset from CSV text or row objects.",
      {
        input: registerDatasetInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dataset.write",
          { kind: "dataset", workspaceId: input.workspaceId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dataset = await backend.registerDataset(applyCreationContext(input, context), context);
        return datasetResponse(dataset);
      }
    );
  }

  if (toolEnabled("update_dataset", toolMode)) {
    server.tool(
      "update_dataset",
      "Update an existing dataset in place (mode = replace|append).",
      {
        input: updateDatasetInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dataset.write",
          { kind: "dataset", datasetId: input.datasetId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dataset = await backend.updateDataset(input, context);
        return datasetResponse(dataset);
      }
    );
  }

  if (toolEnabled("restore_dataset_snapshot", toolMode)) {
    server.tool(
      "restore_dataset_snapshot",
      "Restore the last snapshot stored for a dataset (single-level undo).",
      {
        input: restoreDatasetSnapshotInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dataset.write",
          { kind: "dataset", datasetId: input.datasetId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dataset = await backend.restoreDatasetSnapshot(input, context);
        return datasetResponse(dataset);
      }
    );
  }

  if (toolEnabled("list_datasets", toolMode)) {
    server.tool("list_datasets", "List all datasets.", async (extra) => {
      const context = await authorizeRequest(
        policyAdapter,
        "dataset.read",
        { kind: "dataset" },
        extra,
        { enforcePolicy, requestSource }
      );
      const datasets = await backend.listDatasets(context);
      const table = toTable(
        ["id", "name", "rows", "columns", "readOnly", "updatedAt"],
        datasets.map((dataset) => [
          dataset.id,
          dataset.name,
          String(dataset.rows.length),
          String(dataset.columns.length),
          dataset.readOnly ? "yes" : "no",
          dataset.updatedAt
        ])
      );
      return textResponse(table);
    });
  }

  if (toolEnabled("list_dataset_content", toolMode)) {
    server.tool(
      "list_dataset_content",
      "List dataset rows as table with truncation. Input: { datasetId, limit? }",
      {
        input: listDatasetContentInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dataset.read",
          { kind: "dataset", datasetId: input.datasetId },
          extra,
          { enforcePolicy, requestSource }
        );
        const result = await backend.listDatasetContent(input, context);
        const headers = result.columns;
        const rows = result.rows.map((row) => headers.map((header) => String(row[header] ?? "")));
        const table = toTable(headers, rows);
        const footer = `\nRows: ${result.returnedRows}/${result.totalRows}${result.truncated ? " (truncated)" : ""}`;
        return textResponse(table + footer);
      }
    );
  }

  if (toolEnabled("describe_dataset", toolMode)) {
    server.tool(
      "describe_dataset",
      "Describe dataset columns and preview rows.",
      {
        input: describeDatasetInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dataset.read",
          { kind: "dataset", datasetId: input.datasetId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dataset = await backend.describeDataset(input, context);
        return jsonResponse({
          ok: true,
          dataset: {
            id: dataset.id,
            name: dataset.name,
            columns: dataset.columns,
            rowCount: dataset.rowCount,
            sampleRows: dataset.sampleRows
          }
        });
      }
    );
  }

  if (toolEnabled("create_chart", toolMode)) {
    server.tool(
      "create_chart",
      "Unified chart creation from a dataset. Provide type: bar|line|area|scatter|radar|donut|funnel|kpi_card|table|combo|multi_bar.",
      {
        input: createChartFromDatasetInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.createChartFromDataset(input, context);
        return dashboardResponse(dashboard);
      }
    );
  }

  if (toolEnabled("list_dashboard_filters", toolMode)) {
    server.tool(
      "list_dashboard_filters",
      "List all active filters for a dashboard.",
      {
        input: listDashboardFiltersInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.read",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const result = await backend.listDashboardFilters(input, context);
        return textResponse(filtersTable(result.filters));
      }
    );
  }

  if (toolEnabled("update_dashboard_filters", toolMode)) {
    server.tool(
      "update_dashboard_filters",
      "Add and/or remove dashboard filters in one call.",
      {
        input: updateDashboardFiltersInputSchema
      },
      async ({ input }, extra) => {
        const context = await authorizeRequest(
          policyAdapter,
          "dashboard.write",
          { kind: "dashboard", dashboardId: input.dashboardId },
          extra,
          { enforcePolicy, requestSource }
        );
        const dashboard = await backend.updateDashboardFilters(input, context);
        return jsonResponse({
          ok: true,
          dashboard: summarizeDashboard(dashboard),
          filters: (dashboard.filters ?? []).map((filter) => summarizeFilter(filter))
        });
      }
    );
  }

  return server;
}
