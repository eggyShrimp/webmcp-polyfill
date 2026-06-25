import { readFile } from "node:fs/promises";
import {
  createServer as createTlsServer,
  type Server as TlsServer,
} from "node:tls";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { JsonRpcMessage, JsonRpcResponse } from "./types.js";
import { ERROR_CODES, JsonRpcError } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";

export interface WssServerOptions {
  port: number;
  certPath?: string;
  keyPath?: string;
  toolRegistry: ToolRegistry;
}

export class WssServer {
  private server: TlsServer | HttpServer | undefined;
  private wss: WebSocketServer | undefined;
  private readonly opts: WssServerOptions;
  private readonly clients = new Set<WebSocket>();

  constructor(opts: WssServerOptions) {
    this.opts = opts;
  }

  broadcast(method: string, params?: Record<string, unknown>): void {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  async start(): Promise<void> {
    const useTls = Boolean(this.opts.certPath && this.opts.keyPath);

    if (useTls) {
      const [cert, key] = await Promise.all([
        readFile(this.opts.certPath!),
        readFile(this.opts.keyPath!),
      ]);
      this.server = createTlsServer({ cert, key });
    } else {
      this.server = createHttpServer();
    }

    // ws 与 bun-types 的 Server 类型签名略有差异，类型层面用 any 规避
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.wss = new WebSocketServer({ server: this.server as any });

    this.wss.on("connection", (socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      server.once("listening", () => resolve());
      server.once("error", reject);
      server.listen(this.opts.port, "localhost");
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.wss = undefined;
    this.server = undefined;
  }

  private handleConnection(socket: WebSocket): void {
    this.clients.add(socket);

    const cleanup = () => this.clients.delete(socket);
    socket.on("close", cleanup);
    socket.on("error", cleanup);

    socket.on("message", async (raw: Buffer) => {
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(raw.toString()) as JsonRpcMessage;
        if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
          throw new JsonRpcError(ERROR_CODES.INVALID_REQUEST, "Invalid Request");
        }
      } catch (err) {
        const response = this.errorResponse(
          null,
          err instanceof JsonRpcError
            ? err
            : new JsonRpcError(ERROR_CODES.PARSE_ERROR, "Parse error")
        );
        socket.send(JSON.stringify(response));
        return;
      }

      // notification: 无 id，不回复
      if (!("id" in msg)) {
        try {
          await this.route(msg.method, msg.params);
        } catch {
          // notification 不返回错误
        }
        return;
      }

      // request: 有 id，需要回复
      if (typeof msg.id !== "number") {
        const response = this.errorResponse(
          null,
          new JsonRpcError(ERROR_CODES.INVALID_REQUEST, "Invalid Request: id must be a number")
        );
        socket.send(JSON.stringify(response));
        return;
      }

      try {
        const result = await this.route(msg.method, msg.params);
        const response: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: msg.id,
          result,
        };
        socket.send(JSON.stringify(response));
      } catch (err) {
        const response = this.errorResponse(
          msg.id,
          err instanceof JsonRpcError
            ? err
            : new JsonRpcError(
                ERROR_CODES.INTERNAL_ERROR,
                err instanceof Error ? err.message : String(err)
              )
        );
        socket.send(JSON.stringify(response));
      }
    });
  }

  private async route(
    method: string,
    params: Record<string, unknown> | undefined
  ): Promise<unknown> {
    const p = params ?? {};
    switch (method) {
      case "tools/list":
        return { tools: this.opts.toolRegistry.list() };
      case "tools/call": {
        const name = this.requireString(p, "name");
        const args =
          (p.arguments as Record<string, unknown> | undefined) ?? {};
        return this.opts.toolRegistry.call(name, args);
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

  private errorResponse(id: number | null, err: JsonRpcError): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id: id ?? 0,
      error: { code: err.code, message: err.message, data: err.data },
    };
  }
}
