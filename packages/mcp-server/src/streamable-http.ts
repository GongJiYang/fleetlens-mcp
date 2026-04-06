import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { isWorkspaceRole } from "../../core/dist/index.js";
import {
  createLuminonMcpServer,
  formatToolModeStartupMessage,
  resolveToolMode
} from "./server.js";

const toolMode = resolveToolMode(process.env.LUMINON_MCP_MODE);
const port = Number(process.env.MCP_HTTP_PORT ?? process.env.PORT ?? 3001);
const mcpPath = process.env.MCP_HTTP_PATH?.trim() || "/mcp";
const allowOrigin = process.env.MCP_HTTP_ALLOW_ORIGIN?.trim() || "*";
const bearerToken = process.env.MCP_HTTP_BEARER_TOKEN?.trim();
const tokenScopes = (process.env.MCP_HTTP_TOKEN_SCOPES?.trim() || "luminon:*")
  .split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);
const tokenClientId = process.env.MCP_HTTP_TOKEN_CLIENT_ID?.trim() || "luminon-http";
const tokenPrincipalId = process.env.MCP_HTTP_TOKEN_PRINCIPAL_ID?.trim() || tokenClientId;
const tokenWorkspaceId = process.env.MCP_HTTP_TOKEN_WORKSPACE_ID?.trim() || "default";
const tokenRoleRaw = process.env.MCP_HTTP_TOKEN_ROLE?.trim();
const tokenRole = isWorkspaceRole(tokenRoleRaw) ? tokenRoleRaw : "admin";
const tokenLicenseTier = process.env.MCP_HTTP_TOKEN_LICENSE_TIER?.trim() || "commercial";
const tokenExpiresAt = Number(process.env.MCP_HTTP_TOKEN_EXPIRES_AT ?? Math.floor(Date.now() / 1000) + 31536000);

function writeJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function applyCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Session-Id, Last-Event-ID");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
}

function requestAuthorized(req: IncomingMessage): boolean {
  if (!bearerToken) return true;
  const header = req.headers.authorization;
  if (!header) return false;
  const [scheme, token] = header.split(/\s+/, 2);
  return scheme.toLowerCase() === "bearer" && token === bearerToken;
}

function buildStaticAuthInfo(token: string): AuthInfo {
  return {
    token,
    clientId: tokenClientId,
    scopes: tokenScopes,
    expiresAt: tokenExpiresAt,
    extra: {
      principalId: tokenPrincipalId,
      workspaceId: tokenWorkspaceId,
      role: tokenRole,
      licenseTier: tokenLicenseTier
    }
  };
}

async function main() {
  console.error(formatToolModeStartupMessage(toolMode));

  const httpServer = createServer(async (req, res) => {
    applyCors(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.url === "/health") {
      writeJson(res, 200, {
        ok: true,
        transport: "streamable-http",
        toolMode
      });
      return;
    }

    if (req.url !== mcpPath) {
      writeJson(res, 404, { error: "Not found" });
      return;
    }

    if (!requestAuthorized(req)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="luminon-mcp"');
      writeJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (bearerToken) {
      (req as IncomingMessage & { auth?: AuthInfo }).auth = buildStaticAuthInfo(bearerToken);
    }

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      const server = createLuminonMcpServer({
        toolMode,
        requestSource: "remote_mcp",
        enforcePolicy: Boolean(bearerToken)
      });
      await server.connect(transport);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Streamable HTTP request failed", error);
      if (!res.headersSent) {
        writeJson(res, 500, { error: "Internal server error" });
      } else {
        res.end();
      }
    }
  });

  httpServer.listen(port, () => {
    console.error(`mcp-dashboard streamable HTTP on http://localhost:${port}${mcpPath}`);
    if (bearerToken) {
      console.error("mcp-dashboard HTTP auth: bearer token enabled");
    }
  });

  const shutdown = async () => {
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error) => {
  console.error("MCP streamable HTTP server crashed", error);
  process.exit(1);
});
