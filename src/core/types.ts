// ===== MCP 能力定义（对齐 @modelcontextprotocol/sdk）=====

// handler / reader / getter 类型别名（具体响应类型见文件下方）
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export type ResourceReader = () =>
  | Promise<{ text?: string; blob?: string } | string>
  | { text?: string; blob?: string }
  | string;

export type PromptGetter = (
  args: Record<string, unknown>
) => Promise<
  Array<{
    role: "user" | "assistant";
    content: TextContent | string;
  }>
>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

export interface JsonSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: Array<string | number>;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
}

export interface ResourceDef {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface PromptDef {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

// ===== MCP 标准响应类型 =====

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ResourceContent {
  type: "resource";
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export type Content = TextContent | ImageContent | ResourceContent;

export interface CallToolResult {
  content: Content[];
  isError?: boolean;
}

export interface ReadResourceResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

export interface GetPromptResult {
  messages: Array<{
    role: "user" | "assistant";
    content: TextContent;
  }>;
}

// ===== JSON-RPC 2.0 =====

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

// ===== 错误码（JSON-RPC 2.0 + MCP）=====

export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export class JsonRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}
