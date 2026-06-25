import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer, WebSocket } from "ws";
import { ToolRegistry } from "./core/tool-registry.js";
import { createLogger } from "./core/logger.js";
import type { ToolDef, JsonRpcResponse } from "./core/types.js";

const log = createLogger("webmcp-server");

const WS_PORT = Number(process.env.WEBMCP_BROWSER_PORT ?? 3098);
const REQUEST_TIMEOUT = Number(process.env.WEBMCP_REQUEST_TIMEOUT ?? 30000);

const toolRegistry = new ToolRegistry();
let server: Server | undefined;

function startWsServer(): WebSocketServer {
  const wss = new WebSocketServer({ port: WS_PORT, host: "localhost" });
  let browserSocket: WebSocket | undefined;
  const pendingCallbacks = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let nextId = 1;

  const browserToolNames = new Set<string>();
  function sendToBrowser(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!browserSocket || browserSocket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("browser not connected (open the web page first)"));
    }
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCallbacks.delete(id);
        reject(new Error(`request timeout: ${method}`));
      }, REQUEST_TIMEOUT);
      pendingCallbacks.set(id, { resolve, reject, timer });
      browserSocket!.send(payload);
    });
  }

  function unregisterBrowserTools(): void {
    for (const name of browserToolNames) {
      toolRegistry.unregister(name);
    }
    browserToolNames.clear();
  }

  let discoverPromise: Promise<void> | undefined;

  function discoverBrowserTools(): void {
    if (discoverPromise) {
      discoverPromise = discoverPromise.then(() => discoverBrowserToolsOnce());
    } else {
      discoverPromise = discoverBrowserToolsOnce().finally(() => {
        discoverPromise = undefined;
      });
    }
  }

  async function discoverBrowserToolsOnce(): Promise<void> {
    try {
      const result = (await sendToBrowser("tools/list")) as { tools: ToolDef[] };
      for (const def of result.tools ?? []) {
        toolRegistry.register(def.name, def.description, def.inputSchema, async (args) => {
          const callResult = await sendToBrowser("tools/call", {
            name: def.name,
            arguments: args,
          });
          return callResult;
        });
        browserToolNames.add(def.name);
      }
      log.info(
        `discovered ${browserToolNames.size} tools from browser: ${[...browserToolNames].join(", ")}`
      );
      server?.sendToolListChanged();
    } catch (err) {
      log.error(`tools/list failed: ${(err as Error).message}`);
    }
  }

  wss.on("listening", () => {
    log.info(`ws server listening on ws://localhost:${WS_PORT}`);
  });

  wss.on("error", (err) => {
    log.error(`ws server error: ${err.message}`);
  });

  wss.on("connection", (socket) => {
    browserSocket = socket;
    log.info("browser connected");

    socket.on("message", (data: Buffer) => {
      const text = data.toString();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }

      // notification: no id
      if (!("id" in parsed) && parsed.jsonrpc === "2.0" && typeof parsed.method === "string") {
        if (
          parsed.method === "notifications/initialized" ||
          parsed.method === "notifications/tools/list_changed"
        ) {
          unregisterBrowserTools();
          discoverBrowserTools();
        }
        return;
      }

      // response: has id
      const msg = parsed as unknown as JsonRpcResponse;
      const entry = pendingCallbacks.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pendingCallbacks.delete(msg.id);
      if (msg.error) {
        entry.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      } else {
        entry.resolve(msg.result);
      }
    });

    socket.on("close", () => {
      log.info("browser disconnected");
      unregisterBrowserTools();
      server?.sendToolListChanged();
      browserSocket = undefined;
      for (const [, entry] of pendingCallbacks) {
        clearTimeout(entry.timer);
        entry.reject(new Error("browser disconnected"));
      }
      pendingCallbacks.clear();
    });

    socket.on("error", (err) => {
      log.error(`ws error: ${err.message}`);
    });

    // browser sends "initialized" on connect, triggering discovery
  });

  return wss;
}

async function main(): Promise<void> {
  const wss = startWsServer();

  server = new Server(
    { name: "webmcp", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolRegistry.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await toolRegistry.call(name, (args ?? {}) as Record<string, unknown>);
    return {
      content: result.content,
      isError: result.isError,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info("mcp server connected via stdio");

  // graceful shutdown
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  async function shutdown(): Promise<void> {
    log.info("shutting down");
    await server?.close();
    wss.close();
    process.exit(0);
  }
}

main().catch((err) => {
  log.error(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
