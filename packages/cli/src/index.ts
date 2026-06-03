#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

interface ManagedProcess {
  pid?: number;
  logPath?: string;
  startedAt?: string;
  mode?: "managed" | "stdio";
}

interface LockFile {
  dataDir: string;
  mcp?: ManagedProcess;
  renderer?: ManagedProcess;
  remote?: ManagedProcess;
}

type StartTarget = "stack" | "mcp" | "renderer" | "remote";
type StopTarget = "stack" | "mcp" | "renderer" | "remote";
type ManagedTarget = "mcp" | "renderer" | "remote";
type McpMode = "full" | "lite" | "ultra-lite";
type RuntimeCommand = { command: string; args: string[]; env?: NodeJS.ProcessEnv };
type TokenCommand = "create" | "list" | "delete" | "current" | "set-default";

type StoredToken = {
  id: string;
  name: string;
  secret: string;
  createdAt: string;
  isDefault?: boolean;
};

type TokenStore = {
  version: 1;
  tokens: StoredToken[];
  defaultTokenId?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const dataDir = resolveDataDir();
const lockPath = path.join(dataDir, ".luminon-lock.json");
const logsDir = path.join(dataDir, "logs");
const tokenPath = path.join(dataDir, "tokens.secure.json");

function expandHomeDir(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
}

function ensureWritableDir(target: string): boolean {
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDataDir(): string {
  const requested = expandHomeDir(process.env.MCP_DATA_DIR?.trim()) ?? path.join(os.homedir(), "Documents", "luminon");
  if (ensureWritableDir(requested)) return requested;

  const fallback = path.join(os.tmpdir(), "luminon");
  if (ensureWritableDir(fallback)) {
    console.error(`Luminon data dir '${requested}' is not writable. Falling back to '${fallback}'.`);
    return fallback;
  }

  return requested;
}

function ensureBaseDir(): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
}

function readLock(): LockFile | null {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8")) as LockFile;
  } catch {
    return null;
  }
}

function writeLock(lock: LockFile): void {
  ensureBaseDir();
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");
}

function removeLockIfEmpty(lock: LockFile): void {
  if (lock.mcp || lock.renderer || lock.remote) {
    writeLock(lock);
    return;
  }

  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

function pidAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processLabel(target: ManagedTarget): string {
  if (target === "mcp") return "MCP";
  if (target === "renderer") return "Renderer";
  return "Remote MCP";
}

function sanitizeProcess(proc?: ManagedProcess): ManagedProcess | undefined {
  if (!proc?.pid || !pidAlive(proc.pid)) return undefined;
  return proc;
}

function sanitizeLock(lock: LockFile | null): LockFile | null {
  if (!lock) return null;
  const sanitized: LockFile = {
    dataDir: lock.dataDir,
    mcp: sanitizeProcess(lock.mcp),
    renderer: sanitizeProcess(lock.renderer),
    remote: sanitizeProcess(lock.remote)
  };
  if (!sanitized.mcp && !sanitized.renderer && !sanitized.remote) return null;
  return sanitized;
}

function loadLock(): LockFile {
  const sanitized = sanitizeLock(readLock());
  if (!sanitized) {
    return { dataDir };
  }
  if (!sanitized.mcp || !sanitized.renderer || !sanitized.remote) {
    removeLockIfEmpty(sanitized);
  }
  return sanitized;
}

function updateManagedProcess(target: ManagedTarget, proc?: ManagedProcess): LockFile {
  const lock = loadLock();
  if (target === "mcp") {
    lock.mcp = proc;
  } else if (target === "renderer") {
    lock.renderer = proc;
  } else {
    lock.remote = proc;
  }
  removeLockIfEmpty(lock);
  return lock;
}

function resolveRuntimeEntry(target: ManagedTarget): string {
  const entry = (
    target === "mcp"
      ? path.join(repoRoot, "packages", "mcp-server", "dist", "index.js")
      : target === "remote"
      ? path.join(repoRoot, "packages", "mcp-server", "dist", "streamable-http.js")
      : path.join(repoRoot, "packages", "renderer", "dist", "api-server.js")
  );
  if (!fs.existsSync(entry)) {
    console.error(`Missing compiled ${processLabel(target)} runtime at ${entry}. Run 'npm run build' first.`);
    process.exit(1);
  }
  return entry;
}

function commandFor(target: ManagedTarget, tokenIdOrName?: string): RuntimeCommand {
  const runtimeEntry = resolveRuntimeEntry(target);
  if (target === "mcp") {
    return {
      command: process.execPath,
      args: [runtimeEntry]
    };
  }
  if (target === "remote") {
    const activeToken = pickTokenForRemote(tokenIdOrName);
    if (!activeToken) {
      console.error(
        tokenIdOrName
          ? `No bearer token found for '${tokenIdOrName}'. Run 'luminon token list' or create a new token.`
          : "No bearer token found. Run 'luminon token create <name>' first."
      );
      process.exit(1);
    }
    return {
      command: process.execPath,
      args: [runtimeEntry],
      env: {
        MCP_HTTP_PORT: process.env.MCP_HTTP_PORT ?? "3001",
        MCP_HTTP_PATH: process.env.MCP_HTTP_PATH ?? "/mcp",
        MCP_HTTP_BEARER_TOKEN: activeToken.secret
      }
    };
  }
  return {
    command: process.execPath,
    args: [runtimeEntry],
    env: {
      RENDERER_PORT: "5173",
      LUMINON_RENDERER_STATIC: "true"
    }
  };
}

function logPathFor(target: ManagedTarget): string {
  return path.join(logsDir, `${target}.log`);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.unref();
  } catch (error) {
    console.warn(`Failed to open browser: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function startManagedProcess(target: ManagedTarget, tokenIdOrName?: string): number {
  ensureBaseDir();
  const existing = loadLock();
  const current = target === "mcp" ? existing.mcp : target === "renderer" ? existing.renderer : existing.remote;
  if (current?.pid && pidAlive(current.pid)) {
    console.error(`${processLabel(target)} is already running. Use 'luminon status' or 'luminon stop ${target}'.`);
    process.exit(1);
  }

  const runtime = commandFor(target, tokenIdOrName);
  const { command, args } = runtime;
  const logPath = logPathFor(target);
  const logFd = fs.openSync(logPath, "a");
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    env: { ...process.env, MCP_DATA_DIR: dataDir, ...runtime.env },
    stdio: ["ignore", logFd, logFd]
  });
  fs.closeSync(logFd);

  if (process.platform !== "win32") {
    child.unref();
  }

  updateManagedProcess(target, {
    pid: child.pid,
    logPath,
    startedAt: new Date().toISOString(),
    mode: "managed"
  });

  console.log(`${processLabel(target)} started (pid ${child.pid ?? "unknown"}). Log: ${logPath}`);

  if (target === "renderer") {
    const port = runtime.env?.RENDERER_PORT ?? runtime.env?.RENDERER_API_PORT ?? "5173";
    const base = `http://localhost:${port}`;
    if (runtime.env?.LUMINON_RENDERER_STATIC === "true") {
      console.log(`Renderer UI: ${base}`);
      console.log(`Renderer API: ${base}/api`);
    } else {
      console.log(`Renderer API: ${base}`);
    }
  }
  if (target === "remote") {
    const port = runtime.env?.MCP_HTTP_PORT ?? "3001";
    const mcpPathValue = runtime.env?.MCP_HTTP_PATH ?? "/mcp";
    console.log(`Remote MCP: http://localhost:${port}${mcpPathValue}`);
    console.log(`Health: http://localhost:${port}/health`);
  }
  return child.pid ?? 0;
}

function stopManagedProcess(target: ManagedTarget): boolean {
  const lock = loadLock();
  const proc = target === "mcp" ? lock.mcp : target === "renderer" ? lock.renderer : lock.remote;
  if (!proc?.pid || !pidAlive(proc.pid)) {
    updateManagedProcess(target, undefined);
    console.log(`${processLabel(target)} is already stopped.`);
    return false;
  }

  try {
    if (process.platform !== "win32") {
      process.kill(-proc.pid, "SIGTERM");
    } else {
      process.kill(proc.pid, "SIGTERM");
    }
  } catch {
    try {
      process.kill(proc.pid, "SIGTERM");
    } catch {
      // ignore
    }
  }

  updateManagedProcess(target, undefined);
  console.log(`${processLabel(target)} stopped.`);
  return true;
}

function printStatus(): void {
  const lock = loadLock();
  const mcp = sanitizeProcess(lock.mcp);
  const renderer = sanitizeProcess(lock.renderer);
  const remote = sanitizeProcess(lock.remote);
  const lockExists = fs.existsSync(lockPath);

  console.log(`Data dir: ${dataDir}`);
  console.log(`Lock file: ${lockExists ? lockPath : "(none)"}`);
  console.log(
    `MCP: ${
      mcp?.pid
        ? `running (pid ${mcp.pid}, mode ${mcp.mode ?? "managed"}${mcp.logPath ? `, log ${mcp.logPath}` : ""})`
        : "host-managed or stopped (AI Tool stdio MCP may not appear here)"
    }`
  );
  console.log(
    `Renderer: ${
      renderer?.pid
        ? `running (pid ${renderer.pid}${renderer.logPath ? `, log ${renderer.logPath}` : ""})`
        : "stopped"
    }`
  );
  console.log(
    `Remote MCP: ${
      remote?.pid
        ? `running (pid ${remote.pid}${remote.logPath ? `, log ${remote.logPath}` : ""})`
        : "stopped"
    }`
  );
}

function usage(): void {
  console.log(`Usage:
  luminon mcp [--mode MODE]      # run MCP over stdio for an AI Tool
  luminon start                  # start renderer at http://localhost:5173
  luminon start renderer         # start only renderer at http://localhost:5173
  luminon start stack            # start renderer + remote MCP
  luminon start remote [--token ID|NAME] # start only remote MCP over HTTP
    --no-open                    # do not open the browser
    --open                       # force opening the browser
  luminon stop renderer          # stop only renderer
  luminon stop remote            # stop only remote MCP
  luminon stop mcp               # explain how to stop a host-managed MCP
  luminon token create [name]    # generate and store a bearer token
  luminon token list             # list stored token ids
  luminon token current          # show the current/default token
  luminon token set-default <id|name> # make a token the default for start remote
  luminon token delete <id|name> # delete a stored token
  luminon status                 # show running processes and data dir
  luminon help                   # show this message`);
}

function parseMcpMode(args: string[]): McpMode | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--mode") {
      const value = args[i + 1]?.trim().toLowerCase();
      if (value === "full" || value === "lite" || value === "ultra-lite") {
        return value;
      }
      console.error("Invalid MCP mode. Use: full, lite, or ultra-lite.");
      process.exit(1);
    }
    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length).trim().toLowerCase();
      if (value === "full" || value === "lite" || value === "ultra-lite") {
        return value;
      }
      console.error("Invalid MCP mode. Use: full, lite, or ultra-lite.");
      process.exit(1);
    }
  }
  return undefined;
}

async function waitForRendererReady(port: string, timeoutMs = 15000, intervalMs = 300): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://localhost:${port}/api/health`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      // ignore and retry
    }
    await sleep(intervalMs);
  }
  return false;
}

function parseTokenSelector(raw: string[]): { tokenIdOrName?: string; rest: string[] } {
  const rest: string[] = [];
  let tokenIdOrName: string | undefined;

  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (!entry) continue;
    if (entry === "--token") {
      const value = raw[i + 1]?.trim();
      if (!value) {
        console.error("Missing token value for --token.");
        process.exit(1);
      }
      tokenIdOrName = value;
      i += 1;
      continue;
    }
    if (entry.startsWith("--token=")) {
      const value = entry.slice("--token=".length).trim();
      if (!value) {
        console.error("Missing token value for --token.");
        process.exit(1);
      }
      tokenIdOrName = value;
      continue;
    }
    rest.push(entry);
  }

  return { tokenIdOrName, rest };
}

async function start(target: StartTarget, options?: { open?: boolean; tokenIdOrName?: string }): Promise<void> {
  if (target === "mcp") {
    console.error("MCP uses stdio and must be started with 'luminon mcp' from an AI Tool, not with 'start mcp'.");
    process.exit(1);
  }
  if (target === "stack") {
    startManagedProcess("remote", options?.tokenIdOrName);
    await start("renderer", options);
    return;
  }
  if (target === "renderer") {
    const shouldOpen = options?.open !== false;
    startManagedProcess("renderer");
    if (shouldOpen) {
      const port = process.env.RENDERER_PORT ?? process.env.RENDERER_API_PORT ?? "5173";
      const ready = await waitForRendererReady(port);
      if (!ready) {
        console.warn(`Renderer is still starting; refresh if you see 404. (port ${port})`);
      }
      openBrowser(`http://localhost:${port}`);
    }
  }
  if (target === "remote") {
    startManagedProcess("remote", options?.tokenIdOrName);
  }
}

function stop(target: StopTarget): void {
  if (target === "stack") {
    stopManagedProcess("renderer");
    stopManagedProcess("remote");
    console.log("A host-managed MCP stops when the AI Tool session closes.");
    return;
  }
  if (target === "renderer") {
    stopManagedProcess("renderer");
  }
  if (target === "remote") {
    stopManagedProcess("remote");
  }
  if (target === "mcp") {
    console.log("A host-managed MCP stops when the AI Tool session closes.");
  }
}

function clearStdioMcpLock(): void {
  const lock = loadLock();
  if (lock.mcp?.mode === "stdio") {
    updateManagedProcess("mcp", undefined);
  }
}

function runMcpStdio(modeOverride?: McpMode): void {
  ensureBaseDir();
  clearStdioMcpLock();

  const { command, args } = commandFor("mcp");
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      MCP_DATA_DIR: dataDir,
      ...(modeOverride ? { LUMINON_MCP_MODE: modeOverride } : {})
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  process.stdin.pipe(child.stdin!);
  child.stdout!.pipe(process.stdout);
  child.stderr!.pipe(process.stderr);

  process.stdin.on("close", () => {
    child.stdin?.end();
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

function parseStartArgs(raw: string[]): { target: StartTarget; open: boolean } {
  let target: StartTarget | undefined;
  let open = true;

  for (const entry of raw) {
    if (!entry) continue;
    if (entry === "--no-open") {
      open = false;
      continue;
    }
    if (entry === "--open") {
      open = true;
      continue;
    }
    if (["renderer", "mcp", "stack", "remote"].includes(entry)) {
      target = entry as StartTarget;
      continue;
    }
    usage();
    process.exit(1);
  }

  return { target: target ?? "renderer", open };
}

function fingerprintToken(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}

function keyMaterialForTokens(): Buffer {
  const machineBound = `${os.homedir()}|${os.hostname()}|${process.platform}|${process.arch}|luminon`;
  return scryptSync(machineBound, "luminon-token-store", 32);
}

function writeTokenStore(store: TokenStore): void {
  ensureBaseDir();
  const key = keyMaterialForTokens();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(store), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    version: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64")
  };
  fs.writeFileSync(tokenPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
}

function readTokenStore(): TokenStore {
  try {
    const raw = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as {
      version?: number;
      iv?: string;
      tag?: string;
      data?: string;
    };
    if (raw.version !== 1 || !raw.iv || !raw.tag || !raw.data) {
      return { version: 1, tokens: [] };
    }
    const key = keyMaterialForTokens();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(raw.iv, "base64"));
    decipher.setAuthTag(Buffer.from(raw.tag, "base64"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(raw.data, "base64")), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString("utf8")) as TokenStore;
    return parsed.version === 1 && Array.isArray(parsed.tokens) ? parsed : { version: 1, tokens: [] };
  } catch {
    return { version: 1, tokens: [] };
  }
}

function normalizeTokenName(name?: string): string {
  return name && name.trim().length > 0 ? name.trim() : `token-${new Date().toISOString().slice(0, 10)}`;
}

function generateTokenValue(): string {
  return `lum_${randomBytes(24).toString("base64url")}`;
}

function pickActiveToken(): StoredToken | undefined {
  const store = readTokenStore();
  if (store.tokens.length === 0) return undefined;
  if (store.defaultTokenId) {
    const defaultToken = store.tokens.find((token) => token.id === store.defaultTokenId);
    if (defaultToken) return defaultToken;
  }
  return store.tokens[store.tokens.length - 1];
}

function pickTokenForRemote(tokenIdOrName?: string): StoredToken | undefined {
  const store = readTokenStore();
  if (!tokenIdOrName) return pickActiveToken();
  const needle = tokenIdOrName.trim();
  return store.tokens.find((token) => token.id === needle || token.name === needle);
}

function markDefaultToken(tokenId: string): void {
  const store = readTokenStore();
  const token = store.tokens.find((entry) => entry.id === tokenId);
  if (!token) {
    console.error(`No token found for '${tokenId}'.`);
    process.exit(1);
  }
  store.defaultTokenId = token.id;
  store.tokens = store.tokens.map((entry) => ({
    ...entry,
    isDefault: entry.id === token.id
  }));
  writeTokenStore(store);
  console.log(`Default token set to ${token.name} (${token.id}).`);
}

function runTokenCommand(action: TokenCommand | undefined, args: string[]): void {
  if (!action || !["create", "list", "delete", "current", "set-default"].includes(action)) {
    usage();
    process.exit(1);
  }

  const store = readTokenStore();

  if (action === "list") {
    if (store.tokens.length === 0) {
      console.log("No tokens stored.");
      return;
    }
    for (const token of store.tokens) {
      const defaultMark = store.defaultTokenId === token.id ? " (default)" : "";
      console.log(`${token.id}  name=${token.name}${defaultMark}  created=${token.createdAt}`);
    }
    return;
  }

  if (action === "current") {
    const current = pickActiveToken();
    if (!current) {
      console.log("No tokens stored.");
      return;
    }
    console.log(`${current.id}  name=${current.name}  created=${current.createdAt}`);
    return;
  }

  if (action === "create") {
    const name = normalizeTokenName(args[0]);
    const secret = generateTokenValue();
    const token: StoredToken = {
      id: fingerprintToken(secret),
      name,
      secret,
      createdAt: new Date().toISOString()
    };
    store.tokens.push(token);
    store.defaultTokenId = token.id;
    store.tokens = store.tokens.map((entry) => ({
      ...entry,
      isDefault: entry.id === token.id
    }));
    writeTokenStore(store);
    console.log(`Token created: id=${token.id} name=${token.name}`);
    console.log(`Bearer token (save now, shown once): ${token.secret}`);
    return;
  }

  if (action === "set-default") {
    const needle = (args[0] ?? "").trim();
    if (!needle) {
      console.error("Provide token id or name: luminon token set-default <id|name>");
      process.exit(1);
    }
    const token = store.tokens.find((entry) => entry.id === needle || entry.name === needle);
    if (!token) {
      console.error(`No token found for '${needle}'.`);
      process.exit(1);
    }
    markDefaultToken(token.id);
    return;
  }

  const needle = (args[0] ?? "").trim();
  if (!needle) {
    console.error("Provide token id or name: luminon token delete <id|name>");
    process.exit(1);
  }

  const before = store.tokens.length;
  store.tokens = store.tokens.filter((token) => token.id !== needle && token.name !== needle);
  if (store.tokens.length === before) {
    console.error(`No token found for '${needle}'.`);
    process.exit(1);
  }
  if (store.defaultTokenId && !store.tokens.some((token) => token.id === store.defaultTokenId)) {
    store.defaultTokenId = store.tokens.at(-1)?.id;
  }
  store.tokens = store.tokens.map((entry) => ({
    ...entry,
    isDefault: entry.id === store.defaultTokenId
  }));
  writeTokenStore(store);
  console.log(`Deleted token '${needle}'.`);
}

async function main(): Promise<void> {
  const [cmd, arg, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    usage();
    process.exit(0);
  }

  if (cmd === "mcp") {
    const modeOverride = parseMcpMode([arg, ...rest].filter((value): value is string => Boolean(value)));
    runMcpStdio(modeOverride);
  } else if (cmd === "start") {
    const { tokenIdOrName, rest: startArgs } = parseTokenSelector([arg, ...rest].filter((value): value is string => Boolean(value)));
    const { target, open } = parseStartArgs(startArgs);
    await start(target, { open, tokenIdOrName });
  } else if (cmd === "stop") {
    const target = (arg as StopTarget | undefined) ?? "stack";
    if (!["stack", "mcp", "renderer", "remote"].includes(target)) {
      usage();
      process.exit(1);
    }
    stop(target);
  } else if (cmd === "token") {
    runTokenCommand(arg as TokenCommand | undefined, rest);
  } else if (cmd === "status") {
    printStatus();
  } else {
    usage();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
