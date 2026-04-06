import type { Dashboard, Dataset, Template, ThemePreset } from "../../shared/dist/index.js";

export type DataPaths = {
  baseDir: string;
  dashboards: string;
  datasets: string;
  snapshots: string;
  datasetSnapshots: string;
  deletedDashboards: string;
};

export type WorkspaceRole = "system" | "owner" | "admin" | "editor" | "viewer";
export type DashboardVisibility = "private" | "workspace" | "public";
export type ContextSource = "local_cli" | "renderer_api" | "remote_mcp" | "unknown";

export type RequestContext = {
  source: ContextSource;
  principalId?: string;
  workspaceId?: string;
  role?: WorkspaceRole;
  licenseTier?: string;
  scopes?: string[];
};

export type DatasetRowValue = string | number | null;
export type DatasetRowInput = Record<string, DatasetRowValue>;

export type RenameDashboardInput = {
  dashboardId: string;
  name: string;
};

export type SetDashboardPublishStateInput = {
  dashboardId: string;
  published: boolean;
};

export type RemoveDashboardFilterInput = {
  dashboardId: string;
  filterId: string;
};

export type UpdateDatasetInput = {
  datasetId: string;
  csv?: string;
  rows?: DatasetRowInput[];
  mode?: "replace" | "append";
  allowSchemaChange?: boolean;
};

export interface LocalWorkspaceStorage {
  ensureUserDataFiles(): Promise<void>;
  getDataPaths(): DataPaths;
  listDashboards(context?: RequestContext): Promise<Dashboard[]>;
  listDatasets(context?: RequestContext): Promise<Dataset[]>;
  renameDashboard(input: RenameDashboardInput, context?: RequestContext): Promise<Dashboard>;
  updateDataset(input: UpdateDatasetInput, context?: RequestContext): Promise<Dataset>;
  setDashboardPublishState(input: SetDashboardPublishStateInput, context?: RequestContext): Promise<Dashboard>;
  removeDashboardFilter(input: RemoveDashboardFilterInput, context?: RequestContext): Promise<Dashboard>;
}

export type PolicyAction =
  | "dashboard.read"
  | "dashboard.write"
  | "dataset.read"
  | "dataset.write"
  | "content.read";

export type PolicyResource =
  | { kind: "dashboard"; dashboardId?: string; workspaceId?: string; visibility?: DashboardVisibility }
  | { kind: "dataset"; datasetId?: string; workspaceId?: string }
  | { kind: "content"; contentId?: string; premium?: boolean };

export type PolicyDecision = {
  allowed: boolean;
  reason?: string;
};

export interface PolicyAdapter {
  authorize(input: {
    action: PolicyAction;
    resource: PolicyResource;
    context: RequestContext;
  }): Promise<PolicyDecision> | PolicyDecision;
}

export type ThemeDefinition = {
  id: ThemePreset;
  description?: string;
  premium?: boolean;
};

export type ChartDefinition = {
  id: string;
  label: string;
  premium?: boolean;
};

export interface ContentRegistry {
  listThemes(): Promise<ThemeDefinition[]> | ThemeDefinition[];
  listTemplates(): Promise<Template[]> | Template[];
  listCharts(): Promise<ChartDefinition[]> | ChartDefinition[];
}

export type WorkspaceChangeEvent =
  | { type: "dashboards_updated"; reason: string; timestamp: string }
  | { type: "datasets_updated"; reason: string; timestamp: string };

export interface ChangeNotifier {
  publish(event: WorkspaceChangeEvent): Promise<void> | void;
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === "system" || value === "owner" || value === "admin" || value === "editor" || value === "viewer";
}

function normalizeResourceScopeKind(resource: PolicyResource): string {
  return resource.kind === "content" ? "content" : resource.kind;
}

function normalizeActionScopeLevel(action: PolicyAction): "read" | "write" {
  return action.endsWith(".write") ? "write" : "read";
}

export function createScopePolicyAdapter(): PolicyAdapter {
  return {
    authorize: ({ action, resource, context }) => {
      const scopes = context.scopes ?? [];
      if (scopes.length === 0) {
        return { allowed: true };
      }

      const resourceKind = normalizeResourceScopeKind(resource);
      const level = normalizeActionScopeLevel(action);
      const acceptedScopes = new Set<string>([
        "luminon:*",
        `luminon:${resourceKind}:*`,
        `luminon:${resourceKind}:${level}`
      ]);

      if (level === "read") {
        acceptedScopes.add("luminon:read");
        acceptedScopes.add("luminon:write");
        acceptedScopes.add(`luminon:${resourceKind}:write`);
      } else {
        acceptedScopes.add("luminon:write");
      }

      const allowed = scopes.some((scope) => acceptedScopes.has(scope));
      return {
        allowed,
        reason: allowed ? undefined : `Missing required scope for ${action}`
      };
    }
  };
}

export const allowAllPolicyAdapter: PolicyAdapter = {
  authorize: () => ({ allowed: true })
};

export const noopChangeNotifier: ChangeNotifier = {
  publish: () => {}
};
