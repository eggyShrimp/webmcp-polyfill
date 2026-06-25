// 浏览器侧 MCPHost —— 浏览器不能监听端口，故作为 WebSocket 客户端连接 Bun relay
// 复用 core 的三个 registry，但接收来自 relay 的 JSON-RPC 请求并响应
import { ToolRegistry } from "../core/tool-registry.js";
import { ResourceRegistry } from "../core/resource-registry.js";
import { PromptRegistry } from "../core/prompt-registry.js";
import type {
  ToolHandler,
  ResourceReader,
  PromptGetter,
  PromptDef,
  ToolDef,
  JsonRpcRequest,
  JsonRpcResponse,
  Content,
} from "../core/types.js";
import { ERROR_CODES, JsonRpcError } from "../core/types.js";

export interface BrowserMCPHostToolOptions {
  description: string;
  inputSchema: ToolDef["inputSchema"];
  execute: ToolHandler;
}

export interface BrowserMCPHostResourceOptions {
  name: string;
  mimeType?: string;
  read: ResourceReader;
}

export interface BrowserMCPHostPromptOptions {
  description: string;
  arguments?: PromptDef["arguments"];
  get: PromptGetter;
}

export interface BrowserMCPHostOptions {
  /** relay server 暴露给浏览器的连接地址，如 ws://localhost:3098 */
  url: string;
  /** 断线重连间隔（毫秒），默认 2000 */
  reconnectInterval?: number;
  /** 客户端标识，用于在工具描述和资源/提示词名称中加前缀，如 "web" 或 "web/dashboard" */
  meta?: string;
}

type StatusCallback = (status: "connecting" | "connected" | "disconnected") => void;

export class BrowserMCPHost {
  private readonly toolRegistry = new ToolRegistry();
  private readonly resourceRegistry = new ResourceRegistry();
  private readonly promptRegistry = new PromptRegistry();
  private readonly url: string;
  private readonly reconnectInterval: number;
  private readonly meta: string;
  private ws: WebSocket | undefined;
  private shouldReconnect = true;
  private readonly statusCallbacks = new Set<StatusCallback>();

  constructor(options: BrowserMCPHostOptions) {
    this.url = options.url;
    this.reconnectInterval = options.reconnectInterval ?? 2000;
    this.meta = options.meta ?? "";
    this.registerBridgeTools();
  }

  private registerBridgeTools(): void {
    this.toolRegistry.register(
      "webmcp_resources_list",
      "列出浏览器 host 注册的所有 resources",
      { type: "object", properties: {} },
      async () => {
        const resources = this.resourceRegistry.list().map((r) => ({
          ...r,
          name: this.meta ? `[${this.meta}] ${r.name}` : r.name,
        }));
        return { content: [{ type: "text", text: JSON.stringify({ resources }, null, 2) } as Content] };
      }
    );
    this.toolRegistry.register(
      "webmcp_resources_read",
      "读取浏览器 host 中的 resource",
      {
        type: "object",
        properties: { uri: { type: "string", description: "resource URI" } },
        required: ["uri"],
      },
      async (args) => {
        const result = await this.resourceRegistry.read(String(args.uri));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) } as Content] };
      }
    );
    this.toolRegistry.register(
      "webmcp_prompts_list",
      "列出浏览器 host 注册的所有 prompts",
      { type: "object", properties: {} },
      async () => {
        const prompts = this.promptRegistry.list().map((p) => ({
          ...p,
          name: this.meta ? `[${this.meta}] ${p.name}` : p.name,
        }));
        return { content: [{ type: "text", text: JSON.stringify({ prompts }, null, 2) } as Content] };
      }
    );
    this.toolRegistry.register(
      "webmcp_prompts_get",
      "获取浏览器 host 中的 prompt",
      {
        type: "object",
        properties: {
          name: { type: "string", description: "prompt 名称" },
          arguments: { type: "object", description: "prompt 参数" },
        },
        required: ["name"],
      },
      async (args) => {
        let name = String(args.name);
        const prefix = this.meta ? `[${this.meta}] ` : "";
        if (prefix && name.startsWith(prefix)) {
          name = name.slice(prefix.length);
        }
        const result = await this.promptRegistry.get(
          name,
          (args.arguments as Record<string, unknown>) ?? {}
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) } as Content] };
      }
    );
  }

  tool(name: string, options: BrowserMCPHostToolOptions): this {
    this.toolRegistry.register(
      name,
      options.description,
      options.inputSchema,
      options.execute
    );
    this.sendNotification("notifications/tools/list_changed");
    return this;
  }

  resource(uri: string, options: BrowserMCPHostResourceOptions): this {
    this.resourceRegistry.register(
      uri,
      options.name,
      options.mimeType,
      options.read
    );
    return this;
  }

  prompt(name: string, options: BrowserMCPHostPromptOptions): this {
    this.promptRegistry.register(name, {
      description: options.description,
      arguments: options.arguments,
      get: options.get,
    });
    return this;
  }

  onStatus(cb: StatusCallback): void {
    this.statusCallbacks.add(cb);
  }

  /** 建立 WebSocket 连接；resolve 后表示首次连接成功 */
  async connect(): Promise<void> {
    this.shouldReconnect = true;
    await this.openConnection();
  }

  private openConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.emitStatus("connecting");
      // 浏览器原生 WebSocket
      const ws = new WebSocket(this.url);
      this.ws = ws;

      let settled = false;
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        this.emitStatus("connected");
        this.sendNotification("notifications/initialized");
        resolve();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error(`Connect failed: ${this.url}`));
        }
      };
      ws.onclose = () => {
        this.emitStatus("disconnected");
        this.ws = undefined;
        if (this.shouldReconnect) {
          setTimeout(() => {
            if (this.shouldReconnect) this.openConnection().catch(() => {});
          }, this.reconnectInterval);
        }
      };
      ws.onmessage = (e: MessageEvent) => {
        const text = typeof e.data === "string"
          ? e.data
          : typeof e.data === "object" && e.data !== null
            ? "" // Blob 等暂不支持
            : String(e.data);
        if (text) void this.handleMessage(text);
      };
    });
  }

  private async handleMessage(text: string): Promise<void> {
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(text) as JsonRpcRequest;
    } catch {
      return; // 忽略无法解析的消息
    }
    let response: JsonRpcResponse;
    try {
      const result = await this.route(req.method, req.params);
      response = { jsonrpc: "2.0", id: req.id, result };
    } catch (err) {
      const e =
        err instanceof JsonRpcError
          ? err
          : new JsonRpcError(
              ERROR_CODES.INTERNAL_ERROR,
              err instanceof Error ? err.message : String(err)
            );
      response = {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: e.code, message: e.message, data: e.data },
      };
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(response));
    }
  }

  private async route(
    method: string,
    params: Record<string, unknown> | undefined
  ): Promise<unknown> {
    const p = params ?? {};
    switch (method) {
      case "tools/list": {
        const tools = this.toolRegistry.list();
        const prefix = this.meta ? `[${this.meta}] ` : "";
        return { tools: prefix ? tools.map((t) => ({ ...t, description: prefix + t.description })) : tools };
      }
      case "tools/call": {
        const name = this.requireString(p, "name");
        const args =
          (p.arguments as Record<string, unknown> | undefined) ?? {};
        return this.toolRegistry.call(name, args);
      }
      default:
        throw new JsonRpcError(
          ERROR_CODES.METHOD_NOT_FOUND,
          `Method not found: ${method}`
        );
    }
  }

  private requireString(
    params: Record<string, unknown>,
    key: string
  ): string {
    const v = params[key];
    if (typeof v !== "string" || v.length === 0) {
      throw new JsonRpcError(
        ERROR_CODES.INVALID_PARAMS,
        `Invalid params: missing or invalid "${key}"`
      );
    }
    return v;
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    }
  }

  private emitStatus(status: "connecting" | "connected" | "disconnected"): void {
    this.statusCallbacks.forEach((cb) => cb(status));
  }

  async close(): Promise<void> {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }
}
