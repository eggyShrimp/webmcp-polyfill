import { ToolRegistry } from "../core/tool-registry.js";
import { ResourceRegistry } from "../core/resource-registry.js";
import { PromptRegistry } from "../core/prompt-registry.js";
import { WssServer } from "../core/wss-server.js";
import type {
  ToolHandler,
  ResourceReader,
  PromptGetter,
  PromptDef,
  ToolDef,
  Content,
} from "../core/types.js";

export interface MCPHostToolOptions {
  description: string;
  inputSchema: ToolDef["inputSchema"];
  execute: ToolHandler;
}

export interface MCPHostResourceOptions {
  name: string;
  mimeType?: string;
  read: ResourceReader;
}

export interface MCPHostPromptOptions {
  description: string;
  arguments?: PromptDef["arguments"];
  get: PromptGetter;
}

export interface MCPHostOptions {
  port?: number;
  certPath?: string;
  keyPath?: string;
}

const DEFAULT_PORT = 3099;

export class MCPHost {
  private readonly toolRegistry = new ToolRegistry();
  private readonly resourceRegistry = new ResourceRegistry();
  private readonly promptRegistry = new PromptRegistry();
  private readonly server: WssServer;

  constructor(options: MCPHostOptions = {}) {
    this.server = new WssServer({
      port: options.port ?? DEFAULT_PORT,
      certPath: options.certPath,
      keyPath: options.keyPath,
      toolRegistry: this.toolRegistry,
    });
    this.registerBridgeTools();
  }

  private registerBridgeTools(): void {
    this.toolRegistry.register(
      "webmcp_resources_list",
      "列出浏览器 host 注册的所有 resources",
      { type: "object", properties: {} },
      async () => {
        const resources = this.resourceRegistry.list();
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
        const prompts = this.promptRegistry.list();
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
        const result = await this.promptRegistry.get(
          String(args.name),
          (args.arguments as Record<string, unknown>) ?? {}
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) } as Content] };
      }
    );
  }

  tool(name: string, options: MCPHostToolOptions): this {
    this.toolRegistry.register(
      name,
      options.description,
      options.inputSchema,
      options.execute
    );
    this.server.broadcast("notifications/tools/list_changed");
    return this;
  }

  resource(uri: string, options: MCPHostResourceOptions): this {
    this.resourceRegistry.register(
      uri,
      options.name,
      options.mimeType,
      options.read
    );
    return this;
  }

  prompt(name: string, options: MCPHostPromptOptions): this {
    this.promptRegistry.register(name, {
      description: options.description,
      arguments: options.arguments,
      get: options.get,
    });
    return this;
  }

  async listen(): Promise<void> {
    await this.server.start();
  }

  async close(): Promise<void> {
    await this.server.stop();
  }
}
