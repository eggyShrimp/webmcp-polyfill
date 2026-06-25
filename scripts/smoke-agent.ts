// 端到端集成测试：MCP server + BrowserMCPHost（在 Bun 中直接跑）
// 自包含，无需真实浏览器。验证：
//   1. WS server 启动，BrowserMCPHost 连入
//   2. server 端自动 tools/list 发现 browser 注册的全部 tool
//   3. tools/call 调用正常
//   4. host 断开后 tool 被正确清理
import { WebSocketServer, WebSocket } from "ws";
import { BrowserMCPHost } from "../src/sdk/browser-host";
import { ToolRegistry } from "../src/core/tool-registry";
import type { ToolDef, JsonRpcResponse, CallToolResult } from "../src/core/types";

const port = Number(process.env.WEBMCP_BROWSER_PORT ?? 3098);
const url = `ws://localhost:${port}`;
const requestTimeout = Number(process.env.WEBMCP_REQUEST_TIMEOUT ?? 30000);

const toolRegistry = new ToolRegistry();

// 启动 WS server（模拟 server.ts 的内部逻辑）
const wss = new WebSocketServer({ port, host: "localhost" });
let browserSocket: WebSocket | undefined;
const pendingCalls = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
let nextId = 1;
const browserToolNames = new Set<string>();

function sendToBrowser(method: string, params?: Record<string, unknown>): Promise<unknown> {
  if (!browserSocket || browserSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("browser not connected"));
  }
  const id = nextId++;
  const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error(`timeout: ${method}`));
    }, requestTimeout);
    pendingCalls.set(id, { resolve, reject, timer });
    browserSocket!.send(payload);
  });
}

let discoverResolve: (() => void) | undefined;
let discoverReject: ((e: Error) => void) | undefined;

async function discoverBrowserTools(): Promise<void> {
  try {
    const result = (await sendToBrowser("tools/list")) as { tools: ToolDef[] };
    for (const def of result.tools ?? []) {
      toolRegistry.register(def.name, def.description, def.inputSchema, async (args) => {
        const callResult = await sendToBrowser("tools/call", { name: def.name, arguments: args });
        return callResult;
      });
      browserToolNames.add(def.name);
    }
    console.log(`[smoke] discovered ${browserToolNames.size} tools: ${[...browserToolNames].join(", ")}`);
    discoverResolve?.();
  } catch (err) {
    console.error(`[smoke] discovery failed: ${(err as Error).message}`);
    discoverReject?.((err as Error));
  }
}

wss.on("connection", (socket) => {
  browserSocket = socket;
  console.log("[smoke] browser connected");

  socket.on("message", (data: Buffer) => {
    const text = data.toString();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    if (!("id" in parsed) && parsed.jsonrpc === "2.0" && typeof parsed.method === "string") {
      if (parsed.method === "notifications/initialized" || parsed.method === "notifications/tools/list_changed") {
        for (const name of browserToolNames) toolRegistry.unregister(name);
        browserToolNames.clear();
        void discoverBrowserTools();
      }
      return;
    }

    const msg = parsed as unknown as JsonRpcResponse;
    const entry = pendingCalls.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingCalls.delete(msg.id);
    if (msg.error) {
      entry.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
    } else {
      entry.resolve(msg.result);
    }
  });

  socket.on("close", () => {
    browserSocket = undefined;
    for (const name of browserToolNames) toolRegistry.unregister(name);
    browserToolNames.clear();
  });
});

console.log(`[smoke] ws server on :${port}`);

// 创建浏览器 host
let counter = 0;
const todos: string[] = [];

const host = new BrowserMCPHost({
  url,
  reconnectInterval: 1000,
});

host.tool("counter_increment", {
  description: "计数器 +1",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    counter++;
    return { count: counter };
  },
});

host.tool("todo_add", {
  description: "添加待办",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  execute: async (args) => {
    todos.push(String(args.text));
    return { todos };
  },
});

host.resource("app://counter/value", {
  name: "计数器值",
  mimeType: "text/plain",
  read: async () => String(counter),
});

host.prompt("counter_summary", {
  description: "计数器总结",
  arguments: [{ name: "style", description: "风格", required: false }],
  get: async (args) => {
    const style = (args.style as string) ?? "默认";
    return [
      { role: "user", content: { type: "text", text: `counter=${counter}, style=${style}` } as const },
    ];
  },
});

// 等待 discovery 完成的 promise
const discoveryDone = new Promise<void>((resolve, reject) => {
  discoverResolve = resolve;
  discoverReject = reject;
});

const discoverTimeout = setTimeout(() => {
  discoverReject?.(new Error("discovery timeout"));
}, 10000);

await host.connect();
console.log("[smoke] host connected");

await discoveryDone;
clearTimeout(discoverTimeout);

// 验证发现的工具（host 侧 2 个自定义 tool + 4 个桥接 tool = 至少 6 个）
const tools = toolRegistry.list();
const toolNames = tools.map((t) => t.name).sort();
console.log(`[smoke] registered tools (${toolNames.length}): ${toolNames.join(", ")}`);

if (!toolNames.includes("counter_increment")) throw new Error("missing counter_increment");
if (!toolNames.includes("todo_add")) throw new Error("missing todo_add");
if (!toolNames.includes("webmcp_resources_list")) throw new Error("missing webmcp_resources_list");
if (!toolNames.includes("webmcp_prompts_list")) throw new Error("missing webmcp_prompts_list");

// 调用 counter_increment
const r1 = (await toolRegistry.call("counter_increment", {})) as CallToolResult;
console.log("[smoke] counter_increment:", JSON.stringify(r1));
const r1Payload = JSON.parse(r1.content[0]?.type === "text" ? r1.content[0].text : "{}") as { count: number };
if (r1Payload.count !== 1) throw new Error(`expected count=1, got ${r1Payload.count}`);

// 调用 todo_add
const r2 = (await toolRegistry.call("todo_add", { text: "测试待办" })) as CallToolResult;
console.log("[smoke] todo_add:", JSON.stringify(r2));
const r2Payload = JSON.parse(r2.content[0]?.type === "text" ? r2.content[0].text : "{}") as { todos: string[] };
if (r2Payload.todos.length !== 1 || r2Payload.todos[0] !== "测试待办") {
  throw new Error(`todo_add mismatch: ${JSON.stringify(r2Payload)}`);
}

// 调用桥接 tool: webmcp_resources_read
const r3 = (await toolRegistry.call("webmcp_resources_read", { uri: "app://counter/value" })) as CallToolResult;
console.log("[smoke] resources_read:", JSON.stringify(r3));

// 调用桥接 tool: webmcp_prompts_get
const r4 = (await toolRegistry.call("webmcp_prompts_get", { name: "counter_summary", arguments: { style: "幽默" } })) as CallToolResult;
console.log("[smoke] prompts_get:", JSON.stringify(r4));

// 断开 host，验证工具被清理
await host.close();
await new Promise((r) => setTimeout(r, 300));
const toolsAfter = toolRegistry.list().map((t) => t.name);
console.log(`[smoke] tools after disconnect: ${toolsAfter.length > 0 ? toolsAfter.join(", ") : "(none)"}`);
if (toolsAfter.length !== 0) throw new Error(`tools not cleaned up: ${toolsAfter.join(", ")}`);

wss.close();
console.log("[smoke] PASS");
