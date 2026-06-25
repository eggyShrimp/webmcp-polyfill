import type { ToolDef, ToolHandler, CallToolResult, Content } from "./types.js";
import { ERROR_CODES, JsonRpcError } from "./types.js";

interface RegisteredTool {
  def: ToolDef;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(
    name: string,
    description: string,
    inputSchema: ToolDef["inputSchema"],
    handler: ToolHandler
  ): void {
    this.tools.set(name, {
      def: { name, description, inputSchema },
      handler,
    });
  }

  list(): ToolDef[] {
    return Array.from(this.tools.values()).map((t) => t.def);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  clear(): void {
    this.tools.clear();
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new JsonRpcError(
        ERROR_CODES.INVALID_PARAMS,
        `Tool not found: ${name}`
      );
    }
    try {
      const result = await tool.handler(args);
      return this.normalizeResult(result);
    } catch (err) {
      // 已是 MCP 错误结构（如手动 throw JsonRpcError）则透传
      if (err instanceof JsonRpcError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  }

  private normalizeResult(result: unknown): CallToolResult {
    if (
      result &&
      typeof result === "object" &&
      "content" in (result as Record<string, unknown>)
    ) {
      return result as CallToolResult;
    }
    // 原始值自动包装
    const text = typeof result === "string" ? result : JSON.stringify(result);
    const content: Content[] = [{ type: "text", text }];
    return { content };
  }
}
