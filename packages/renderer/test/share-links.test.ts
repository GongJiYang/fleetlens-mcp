import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function waitForHealth(
  baseUrl: string,
  child: ChildProcessWithoutNullStreams,
  stderrChunks: string[],
  timeoutMs = 15000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Renderer exited early (${child.exitCode}). Logs:\n${stderrChunks.join("")}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Renderer API did not become healthy in time. Logs:\n${stderrChunks.join("")}`);
}

async function startRenderer(
  tempDir: string,
  port: number,
  rateMaxRequests: number
): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, ["packages/renderer/dist/api-server.js"], {
    cwd: path.resolve(__dirname, "../../.."),
    env: {
      ...process.env,
      MCP_DATA_DIR: tempDir,
      RENDERER_PORT: String(port),
      RENDERER_API_PORT: String(port),
      LUMINON_RENDERER_STATIC: "false",
      LUMINON_SHARE_RATE_MAX_REQUESTS: String(rateMaxRequests),
      LUMINON_SHARE_RATE_WINDOW_MS: "60000"
    },
    stdio: "pipe"
  });
  return child;
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test("share links support passcode create/read/rotate/remove and revoke", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-share-"));
  const port = 5197;
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = await startRenderer(tempDir, port, 20);
  const stderrChunks: string[] = [];
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  try {
    await waitForHealth(baseUrl, child, stderrChunks);

    const dashboardsRes = await fetch(`${baseUrl}/api/dashboards`);
    assert.equal(dashboardsRes.status, 200);
    const dashboardsPayload = await dashboardsRes.json() as { dashboards: Array<{ id: string }> };
    assert.ok(dashboardsPayload.dashboards.length > 0);
    const dashboardId = dashboardsPayload.dashboards[0]!.id;

    const createRes = await fetch(`${baseUrl}/api/dashboards/${encodeURIComponent(dashboardId)}/share-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "review", passcode: "abcd1234" })
    });
    assert.equal(createRes.status, 201);
    const createPayload = await createRes.json() as { shareLink: { id: string; publicToken: string } };
    const shareLinkId = createPayload.shareLink.id;
    const publicToken = createPayload.shareLink.publicToken;

    const unauthRes = await fetch(`${baseUrl}/api/shared/${encodeURIComponent(publicToken)}`);
    assert.equal(unauthRes.status, 401);

    const authRes = await fetch(`${baseUrl}/api/shared/${encodeURIComponent(publicToken)}`, {
      headers: { "x-share-passcode": "abcd1234" }
    });
    assert.equal(authRes.status, 200);

    const rotateRes = await fetch(`${baseUrl}/api/share-links/${encodeURIComponent(shareLinkId)}/passcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: "new-passcode-1" })
    });
    assert.equal(rotateRes.status, 200);

    const oldPassRes = await fetch(`${baseUrl}/api/shared/${encodeURIComponent(publicToken)}`, {
      headers: { "x-share-passcode": "abcd1234" }
    });
    assert.equal(oldPassRes.status, 401);

    const newPassRes = await fetch(`${baseUrl}/api/shared/${encodeURIComponent(publicToken)}`, {
      headers: { "x-share-passcode": "new-passcode-1" }
    });
    assert.equal(newPassRes.status, 200);

    const removePassRes = await fetch(`${baseUrl}/api/share-links/${encodeURIComponent(shareLinkId)}/passcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: "" })
    });
    assert.equal(removePassRes.status, 200);

    const noPassRes = await fetch(`${baseUrl}/api/shared/${encodeURIComponent(publicToken)}`);
    assert.equal(noPassRes.status, 200);

    const revokeRes = await fetch(`${baseUrl}/api/share-links/${encodeURIComponent(shareLinkId)}/revoke`, {
      method: "POST"
    });
    assert.equal(revokeRes.status, 200);

    const afterRevokeRes = await fetch(`${baseUrl}/api/shared/${encodeURIComponent(publicToken)}`);
    assert.equal(afterRevokeRes.status, 404);
  } finally {
    await stopProcess(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("dashboard id endpoint is accessible regardless of publish state", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-publish-"));
  const port = 5198;
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = await startRenderer(tempDir, port, 20);
  const stderrChunks: string[] = [];
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  try {
    await waitForHealth(baseUrl, child, stderrChunks);

    const dashboardsRes = await fetch(`${baseUrl}/api/dashboards`);
    assert.equal(dashboardsRes.status, 200);
    const dashboardsPayload = await dashboardsRes.json() as { dashboards: Array<{ id: string; published?: boolean }> };
    assert.ok(dashboardsPayload.dashboards.length > 0);
    const dashboard = dashboardsPayload.dashboards[0]!;

    const unpublishRes = await fetch(`${baseUrl}/api/dashboards/${encodeURIComponent(dashboard.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: false })
    });
    assert.equal(unpublishRes.status, 200);

    const privateDashboardRes = await fetch(`${baseUrl}/api/dashboards/${encodeURIComponent(dashboard.id)}`);
    assert.equal(privateDashboardRes.status, 200);
  } finally {
    await stopProcess(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("share endpoint enforces rate limit", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "luminon-rate-"));
  const port = 5198;
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = await startRenderer(tempDir, port, 3);
  const stderrChunks: string[] = [];
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  try {
    await waitForHealth(baseUrl, child, stderrChunks);

    const dashboardsRes = await fetch(`${baseUrl}/api/dashboards`);
    const dashboardsPayload = await dashboardsRes.json() as { dashboards: Array<{ id: string }> };
    const dashboardId = dashboardsPayload.dashboards[0]!.id;

    const createRes = await fetch(`${baseUrl}/api/dashboards/${encodeURIComponent(dashboardId)}/share-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "rate-test" })
    });
    const createPayload = await createRes.json() as { shareLink: { publicToken: string } };
    const token = createPayload.shareLink.publicToken;

    const responses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${baseUrl}/api/shared/${encodeURIComponent(token)}`);
      responses.push(res.status);
    }
    assert.ok(responses.includes(429));
  } finally {
    await stopProcess(child);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
