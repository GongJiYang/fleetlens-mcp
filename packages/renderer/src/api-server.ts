import express from "express";
import cors from "cors";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { watch } from "node:fs";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DataPaths, LocalWorkspaceStorage, RequestContext } from "../../core/dist/index.js";
import { type Dashboard, type Dataset } from "../../shared/dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type StorageModule = {
  default?: LocalWorkspaceStorage;
  localWorkspaceStorage?: LocalWorkspaceStorage;
  createRendererRequestContext?: () => RequestContext;
};

async function loadStorageModule(): Promise<{
  storage: LocalWorkspaceStorage;
  requestContext: RequestContext;
}> {
  const candidates = [
    path.resolve(__dirname, "../../mcp-server/dist/local-workspace-storage.js"),
    path.resolve(__dirname, "../../mcp-server/src/local-workspace-storage.ts")
  ];

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      const module = (await import(pathToFileURL(candidate).href)) as StorageModule;
      const storage = module.localWorkspaceStorage ?? module.default;
      if (!storage) {
        continue;
      }
      if (module.localWorkspaceStorage) {
        return {
          storage,
          requestContext: module.createRendererRequestContext?.() ?? { source: "renderer_api" }
        };
      }
      return {
        storage,
        requestContext: module.createRendererRequestContext?.() ?? { source: "renderer_api" }
      };
    }
  }

  throw new Error("Could not resolve the local workspace storage module. Build the repo before starting the packaged renderer.");
}

const loadedStorageModule = await loadStorageModule();
const {
  ensureUserDataFiles,
  getDataPaths,
  listDashboards,
  listDashboardGroups,
  listDatasets,
  removeDashboardFilter,
  renameDashboard,
  updateDataset,
  setDashboardPublishState
} = loadedStorageModule.storage;
const { requestContext } = loadedStorageModule;

const dataPaths = getDataPaths();
const DATA_FILE = dataPaths.dashboards;
const DATASETS_FILE = dataPaths.datasets;
const SHARE_LINKS_FILE = path.join(dataPaths.baseDir, "share_links.json");
const STATIC_WEB_DIR = resolveStaticWebDir();
const SERVE_STATIC_WEB = process.env.LUMINON_RENDERER_STATIC === "true" && Boolean(STATIC_WEB_DIR);

await ensureUserDataFiles();

const app = express();
app.use(cors());
app.use(express.json());
const sseClients = new Set<express.Response>();
let lastBroadcastAt = 0;
const SHARE_LINK_MAX_ACTIVE_PER_DASHBOARD = Number(process.env.LUMINON_SHARE_MAX_ACTIVE ?? 10);
const SHARE_RATE_WINDOW_MS = Number(process.env.LUMINON_SHARE_RATE_WINDOW_MS ?? 60_000);
const SHARE_RATE_MAX_REQUESTS = Number(process.env.LUMINON_SHARE_RATE_MAX_REQUESTS ?? 120);

type ShareLinkRecord = {
  id: string;
  dashboardId: string;
  label: string | null;
  publicToken: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  passcodeHash: string | null;
  passcodeSalt: string | null;
};

type RateBucket = {
  count: number;
  windowStart: number;
};

const sharedRequestRate = new Map<string, RateBucket>();

async function ensureShareLinksStore(): Promise<void> {
  if (fsSync.existsSync(SHARE_LINKS_FILE)) return;
  await fs.writeFile(SHARE_LINKS_FILE, JSON.stringify({ shareLinks: [] }, null, 2), "utf8");
}

async function readShareLinks(): Promise<ShareLinkRecord[]> {
  await ensureShareLinksStore();
  try {
    const raw = JSON.parse(await fs.readFile(SHARE_LINKS_FILE, "utf8")) as { shareLinks?: ShareLinkRecord[] };
    return Array.isArray(raw.shareLinks) ? raw.shareLinks : [];
  } catch {
    return [];
  }
}

async function writeShareLinks(shareLinks: ShareLinkRecord[]): Promise<void> {
  await fs.writeFile(SHARE_LINKS_FILE, JSON.stringify({ shareLinks }, null, 2), "utf8");
}

function derivePasscodeHash(passcode: string, salt: string): string {
  return scryptSync(passcode, salt, 32).toString("hex");
}

function legacyPasscodeHash(passcode: string): string {
  return createHash("sha256").update(passcode).digest("hex");
}

function secureEqualHex(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyPasscode(record: ShareLinkRecord, passcode: string): boolean {
  if (!record.passcodeHash) return true;
  if (record.passcodeSalt) {
    return secureEqualHex(record.passcodeHash, derivePasscodeHash(passcode, record.passcodeSalt));
  }
  // Backward compatibility for previously created links before salted hashing.
  return secureEqualHex(record.passcodeHash, legacyPasscodeHash(passcode));
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeShareToken(): string {
  return `lbs_${randomBytes(18).toString("base64url")}`;
}

function requestIp(req: express.Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.ip || "unknown";
}

function rateLimitShared(req: express.Request, res: express.Response): boolean {
  const key = requestIp(req);
  const now = Date.now();
  const bucket = sharedRequestRate.get(key);
  if (!bucket || now - bucket.windowStart > SHARE_RATE_WINDOW_MS) {
    sharedRequestRate.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= SHARE_RATE_MAX_REQUESTS) {
    res.status(429).json({ error: "Too many shared requests. Try again shortly." });
    return false;
  }
  bucket.count += 1;
  return true;
}

async function readDashboards(): Promise<Dashboard[]> {
  return listDashboards(requestContext);
}

function resolveStaticWebDir(): string | undefined {
  const candidates = [
    path.resolve(__dirname, "../dist/web"),
    path.resolve(__dirname, "web")
  ];

  for (const candidate of candidates) {
    if (fsSync.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return undefined;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/dashboards", async (_req, res) => {
  const dashboards = await readDashboards();
  res.json({ dashboards });
});

app.get("/api/dashboard-groups", async (_req, res) => {
  const [dashboards, groups] = await Promise.all([
    readDashboards(),
    listDashboardGroups({}, requestContext)
  ]);
  const dashboardNameById = new Map(dashboards.map((dashboard) => [dashboard.id, dashboard.name]));
  res.json({
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      slug: group.slug,
      sortOrder: group.sortOrder ?? 0,
      items: (group.items ?? [])
        .filter((item) => dashboardNameById.has(item.dashboardId))
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map((item) => ({
          dashboardId: item.dashboardId,
          dashboardName: dashboardNameById.get(item.dashboardId) ?? item.dashboardId,
          sortOrder: item.sortOrder ?? 0
        }))
    }))
  });
});

app.get("/api/dashboards/:id/share-links", async (req, res) => {
  const shareLinks = await readShareLinks();
  const active = shareLinks.filter((entry) => entry.dashboardId === req.params.id && !entry.revokedAt);
  res.json({
    shareLinks: active.map((entry) => ({
      ...entry,
      shareUrl: `/shared/${encodeURIComponent(entry.publicToken)}`
    }))
  });
});

app.post("/api/dashboards/:id/share-links", async (req, res) => {
  const dashboards = await readDashboards();
  const dashboard = dashboards.find((entry) => entry.id === req.params.id);
  if (!dashboard) {
    res.status(404).json({ error: "Dashboard not found" });
    return;
  }

  const body = req.body as { label?: unknown; expiresAt?: unknown; passcode?: unknown };
  const expiresAt =
    typeof body.expiresAt === "string" && body.expiresAt.trim().length > 0 ? new Date(body.expiresAt).toISOString() : null;
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    res.status(400).json({ error: "Invalid expiresAt" });
    return;
  }

  const passcode = typeof body.passcode === "string" && body.passcode.trim().length > 0 ? body.passcode.trim() : null;
  if (passcode && passcode.length < 4) {
    res.status(400).json({ error: "Passcode must have at least 4 characters" });
    return;
  }

  const createdAt = nowIso();
  const shareLink: ShareLinkRecord = {
    id: `shr_${randomBytes(8).toString("hex")}`,
    dashboardId: dashboard.id,
    label: typeof body.label === "string" && body.label.trim().length > 0 ? body.label.trim() : null,
    publicToken: makeShareToken(),
    expiresAt,
    revokedAt: null,
    createdAt,
    updatedAt: createdAt,
    passcodeHash: null,
    passcodeSalt: passcode ? randomBytes(16).toString("hex") : null
  };
  if (passcode && shareLink.passcodeSalt) {
    shareLink.passcodeHash = derivePasscodeHash(passcode, shareLink.passcodeSalt);
  }

  const shareLinks = await readShareLinks();
  const activeForDashboard = shareLinks.filter((entry) => entry.dashboardId === dashboard.id && !entry.revokedAt).length;
  if (activeForDashboard >= SHARE_LINK_MAX_ACTIVE_PER_DASHBOARD) {
    res.status(400).json({
      error: `Dashboard reached active share link limit (${SHARE_LINK_MAX_ACTIVE_PER_DASHBOARD}). Revoke an existing link first.`
    });
    return;
  }
  shareLinks.push(shareLink);
  await writeShareLinks(shareLinks);
  res.status(201).json({
    shareLink: {
      ...shareLink,
      shareUrl: `/shared/${encodeURIComponent(shareLink.publicToken)}`,
      passcodeProtected: Boolean(shareLink.passcodeHash)
    },
    shareUrl: `/shared/${encodeURIComponent(shareLink.publicToken)}`
  });
});

app.post("/api/share-links/:id/revoke", async (req, res) => {
  const shareLinks = await readShareLinks();
  const link = shareLinks.find((entry) => entry.id === req.params.id);
  if (!link) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }
  if (!link.revokedAt) {
    link.revokedAt = nowIso();
    link.updatedAt = link.revokedAt;
    await writeShareLinks(shareLinks);
  }
  res.json({ shareLink: link });
});

app.post("/api/share-links/:id/passcode", async (req, res) => {
  const body = req.body as { passcode?: unknown };
  if (body.passcode !== undefined && typeof body.passcode !== "string") {
    res.status(400).json({ error: "passcode must be a string or omitted" });
    return;
  }

  const nextPasscode = typeof body.passcode === "string" ? body.passcode.trim() : "";
  if (nextPasscode.length > 0 && nextPasscode.length < 4) {
    res.status(400).json({ error: "Passcode must have at least 4 characters" });
    return;
  }

  const shareLinks = await readShareLinks();
  const link = shareLinks.find((entry) => entry.id === req.params.id);
  if (!link) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }
  if (link.revokedAt) {
    res.status(400).json({ error: "Cannot update passcode for a revoked share link" });
    return;
  }

  if (nextPasscode.length === 0) {
    link.passcodeHash = null;
    link.passcodeSalt = null;
  } else {
    const salt = randomBytes(16).toString("hex");
    link.passcodeSalt = salt;
    link.passcodeHash = derivePasscodeHash(nextPasscode, salt);
  }
  link.updatedAt = nowIso();
  await writeShareLinks(shareLinks);
  res.json({
    shareLink: {
      ...link,
      passcodeProtected: Boolean(link.passcodeHash)
    }
  });
});

app.get("/api/shared/:token", async (req, res) => {
  if (!rateLimitShared(req, res)) return;
  const shareLinks = await readShareLinks();
  const token = req.params.token;
  const link = shareLinks.find((entry) => entry.publicToken === token);
  if (!link || link.revokedAt) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }

  if (link.expiresAt && Date.parse(link.expiresAt) <= Date.now()) {
    res.status(410).json({ error: "Share link expired" });
    return;
  }

  if (link.passcodeHash) {
    const providedRaw = (req.headers["x-share-passcode"] ?? req.query.passcode) as string | undefined;
    const provided = typeof providedRaw === "string" ? providedRaw.trim() : "";
    if (!provided || !verifyPasscode(link, provided)) {
      res.status(401).json({ error: "Passcode required", passcodeRequired: true });
      return;
    }
  }

  const dashboards = await readDashboards();
  const dashboard = dashboards.find((entry) => entry.id === link.dashboardId);
  if (!dashboard) {
    res.status(404).json({ error: "Dashboard not found" });
    return;
  }

  res.json({
    dashboard,
    access: { authenticated: false, role: "viewer", workspaceId: dashboard.workspaceId ?? null, via: "share_link" },
    shareLink: {
      id: link.id,
      label: link.label,
      expiresAt: link.expiresAt,
      shareUrl: `/shared/${encodeURIComponent(link.publicToken)}`
    }
  });
});

app.get("/shared/:token", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Luminon Shared Dashboard</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: #f6f8fb; color: #111827; }
    .wrap { max-width: 920px; margin: 48px auto; background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
    .muted { color: #6b7280; }
    .row { margin: 10px 0; }
    input { padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; }
    button { padding: 8px 12px; border-radius: 8px; border: 1px solid #111827; background: #111827; color: white; cursor: pointer; }
    pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; overflow: auto; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Shared Dashboard</h1>
    <p class="muted">Read-only access via secure share link.</p>
    <div class="row">
      <label for="passcode">Passcode (if required):</label>
      <input id="passcode" type="password" />
      <button id="load">Load</button>
    </div>
    <div id="state" class="muted">Waiting to load...</div>
  </div>
  <script>
    const token = location.pathname.split("/").pop();
    const state = document.getElementById("state");
    const passcode = document.getElementById("passcode");
    const load = document.getElementById("load");
    async function fetchShared() {
      state.textContent = "Loading shared dashboard...";
      const headers = {};
      const value = (passcode.value || "").trim();
      if (value) headers["x-share-passcode"] = value;
      const res = await fetch("/api/shared/" + encodeURIComponent(token), { headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        state.textContent = body.error || "Failed to load.";
        if (body.passcodeRequired) state.textContent += " Enter passcode.";
        return;
      }
      state.textContent = "Loaded. Redirecting...";
      const dashboardId = body && body.dashboard && body.dashboard.id;
      if (!dashboardId) {
        state.textContent = "Loaded but dashboard id is missing.";
        return;
      }
      const query = new URLSearchParams({ shareToken: token });
      if (value) {
        window.sessionStorage.setItem("luminon.share.passcode." + token, value);
      }
      window.location.href = "/dashboards/" + encodeURIComponent(dashboardId) + "?" + query.toString();
    }
    load.addEventListener("click", () => { void fetchShared(); });
    passcode.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void fetchShared();
      }
    });
    void fetchShared();
  </script>
</body>
</html>`);
});

function buildDatasetValueMap(datasets: Dataset[]) {
  const map: Record<string, Record<string, string[]>> = {};
  for (const dataset of datasets) {
    const fieldMap: Record<string, Set<string>> = {};

    for (const row of dataset.rows) {
      for (const column of dataset.columns) {
        const value = row[column];
        if (value === null || value === undefined) continue;
        const str = String(value);
        if (!fieldMap[column]) fieldMap[column] = new Set();
        fieldMap[column].add(str);
      }
    }

    map[dataset.id] = {};
    for (const [field, values] of Object.entries(fieldMap)) {
      map[dataset.id][field] = Array.from(values).sort((a, b) => a.localeCompare(b));
    }
  }
  return map;
}

app.get("/api/datasets", async (_req, res) => {
  try {
    const datasets = await listDatasets(requestContext);
    const datasetValueMap = buildDatasetValueMap(datasets);
    res.json({ datasets, datasetValueMap });
  } catch (error) {
    console.error("Failed to fetch datasets:", error);
    res.json({ datasets: [], datasetValueMap: {} });
  }
});

app.patch("/api/datasets/:id", async (req, res) => {
  try {
    const body = req.body as {
      csv?: string;
      rows?: Array<Record<string, unknown>>;
      mode?: "replace" | "append";
      allowSchemaChange?: boolean;
    };
    const dataset = await updateDataset({
      datasetId: req.params.id,
      csv: body.csv,
      rows: body.rows as Array<Record<string, string | number | null>> | undefined,
      mode: body.mode,
      allowSchemaChange: body.allowSchemaChange
    }, requestContext);
    broadcastDatasetsUpdated("api_patch_dataset");
    res.json({ dataset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update dataset";
    res.status(400).json({ error: message });
  }
});

app.get("/api/dashboards/:id", async (req, res) => {
  const dashboards = await readDashboards();
  const dashboard = dashboards.find((d) => d.id === req.params.id);

  if (!dashboard) {
    res.status(404).json({ error: "Dashboard not found" });
    return;
  }

  res.json({ dashboard });
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: new Date().toISOString() })}\n\n`);
  sseClients.add(res);

  const keepAlive = setInterval(() => {
    res.write(`: keepalive ${Date.now()}\n\n`);
  }, 20000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

function broadcastDashboardsUpdated(reason: string) {
  const now = Date.now();
  if (now - lastBroadcastAt < 250) return;
  lastBroadcastAt = now;

  const payload = `event: dashboards_updated\ndata: ${JSON.stringify({
    reason,
    ts: new Date().toISOString()
  })}\n\n`;

  for (const client of sseClients) {
    client.write(payload);
  }
}

function broadcastDatasetsUpdated(reason: string) {
  const payload = `event: datasets_updated\ndata: ${JSON.stringify({
    reason,
    ts: new Date().toISOString()
  })}\n\n`;

  for (const client of sseClients) {
    client.write(payload);
  }
}

app.patch("/api/dashboards/:id", async (req, res) => {
  try {
    const body = req.body as { name?: unknown; published?: unknown };
    const tasks: Array<Promise<Dashboard>> = [];
    const reasons: string[] = [];

    if (typeof body?.name === "string") {
      tasks.push(
        renameDashboard({
          dashboardId: req.params.id,
          name: body.name
        }, requestContext)
      );
      reasons.push("rename_dashboard");
    }

    if (typeof body?.published === "boolean") {
      tasks.push(
        setDashboardPublishState({
          dashboardId: req.params.id,
          published: body.published
        }, requestContext)
      );
      reasons.push(body.published ? "publish_dashboard" : "unpublish_dashboard");
    }

    if (tasks.length === 0) {
      res.status(400).json({ error: "Invalid payload. Provide name or published fields." });
      return;
    }

    let dashboard: Dashboard | null = null;
    for (const task of tasks) {
      dashboard = await task;
    }

    broadcastDashboardsUpdated(reasons.join("+") || "dashboard_updated");
    res.json({ dashboard });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update dashboard";
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

app.delete("/api/dashboards/:id/filters/:filterId", async (req, res) => {
  try {
      const dashboard = await removeDashboardFilter({
        dashboardId: req.params.id,
        filterId: req.params.filterId
      }, requestContext);
    broadcastDashboardsUpdated("remove_dashboard_filter");
    res.json({ dashboard });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove filter";
    if (/not found/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

if (SERVE_STATIC_WEB && STATIC_WEB_DIR) {
  app.use(express.static(STATIC_WEB_DIR));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(STATIC_WEB_DIR, "index.html"));
  });
}

const PORT = Number(process.env.RENDERER_PORT ?? process.env.RENDERER_API_PORT ?? (SERVE_STATIC_WEB ? 5173 : 4010));
app.listen(PORT, () => {
  console.log(
    SERVE_STATIC_WEB
      ? `Renderer on http://localhost:${PORT}`
      : `Renderer API on http://localhost:${PORT}`
  );
});

watch(DATA_FILE, { persistent: false }, () => {
  broadcastDashboardsUpdated("storage_changed");
});

watch(DATASETS_FILE, { persistent: false }, () => {
  broadcastDatasetsUpdated("dataset_storage_changed");
});
