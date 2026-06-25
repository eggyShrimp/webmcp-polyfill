# webmcp-polyfill

Bridge the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) into the browser. Let web pages register tools, resources, and prompts that AI agents can discover and invoke — just like a native MCP server.

## Architecture

```
┌──────────────┐     stdio (JSON-RPC)     ┌──────────────────┐     WebSocket     ┌──────────────────┐
│  AI Agent    │ ◄──────────────────────► │  Relay Server    │ ◄───────────────► │  Browser Page    │
│  (OpenCode)  │                          │  (src/server.ts) │                   │  (BrowserMCPHost) │
└──────────────┘                          │  port :3098      │                   └──────────────────┘
                                          └──────────────────┘
```

- **Relay Server** — a Bun process that speaks MCP over stdio to the AI agent, while running a WebSocket server that browser pages connect to.
- **Browser Host** (`BrowserMCPHost`) — a WebSocket client with zero Node dependencies. Uses the native browser `WebSocket` API.
- **Server Host** (`MCPHost`) — a standalone host that listens on a TCP port for direct WebSocket connections (no relay needed).
- **Core Registries** — pure TypeScript in-memory registries (`ToolRegistry`, `ResourceRegistry`, `PromptRegistry`) shared between server and browser.

### How it works

1. The relay server starts as a standard MCP stdio server (`@modelcontextprotocol/sdk`).
2. A browser page creates a `BrowserMCPHost`, registers tools, and connects to the relay via WebSocket.
3. On connection, the relay discovers all browser-side tools via `tools/list` and merges them into its own registry.
4. The AI agent sees a unified tool list. When it invokes a browser tool, the relay proxies the `tools/call` over WebSocket to the browser.
5. When the browser disconnects, its tools are automatically cleaned up.

## Relationship to WebMCP / MCP

This project **polyfills** MCP into environments that can't run a TCP server — specifically browsers. Under the standard MCP model, a tool host must listen on a socket or pipe. A browser tab can't do that. `webmcp-polyfill` inverts the connection: the relay listens, and browsers connect as clients. The relay then translates between the agent's stdio MCP transport and the browser's WebSocket transport.

The `webmcp_*` prefixed tools (`webmcp_resources_list`, `webmcp_resources_read`, `webmcp_prompts_list`, `webmcp_prompts_get`) are **bridge tools** that expose resources and prompts through the MCP tool interface, since MCP stdio clients primarily support the `tools/` namespace.

## Use Cases

- **Web-based devtools** — register browser extension tools (DOM inspection, performance profiling, screenshot capture) that AI agents can call directly.
- **In-browser automation** — let an agent control a web app by invoking tools that click buttons, fill forms, or navigate pages.
- **Live dashboards** — expose browser-side data (WebSocket feeds, canvas state, WebGL stats) as MCP resources readable by agents.
- **Hybrid workflows** — combine server-side tools (file system, database) with browser-side tools (page state, user interactions) in a single session.
- **Prototyping MCP servers** — use the browser as a quick REPL to register and test tools without setting up a Node/Bun project.

## Quick Start

```bash
# Install dependencies
bun install

# Generate self-signed TLS certs (for WSS support)
bun run gen-cert

# Start the relay server (MCP over stdio)
bun run mcp

# In another terminal, start the browser demo
bun run web
```

### Minimal browser host

```typescript
import { BrowserMCPHost } from "webmcp-polyfill/sdk/browser";

const host = new BrowserMCPHost("ws://localhost:3098");

host.tool("greet", {
  description: "Greet someone by name",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
  execute: async (args) => {
    return { greeting: `Hello, ${args.name}!` };
  },
});

host.connect();
```

### Minimal server host

```typescript
import { MCPHost } from "webmcp-polyfill/sdk";

const host = new MCPHost({ port: 3098 });

host.tool("add", {
  description: "Add two numbers",
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
  execute: async ({ a, b }) => a + b,
});

host.listen();
```

## Project Structure

```
src/
├── index.ts              Public API barrel export
├── server.ts             MCP relay server (stdio + WebSocket)
├── core/
│   ├── types.ts          TypeScript type definitions
│   ├── logger.ts         Configurable logger
│   ├── tool-registry.ts  Tool registration and invocation
│   ├── resource-registry.ts  Resource registration and reading
│   ├── prompt-registry.ts    Prompt registration and retrieval
│   └── wss-server.ts     WebSocket secure/plain server
└── sdk/
    ├── host.ts           Server-side MCPHost (Bun/Node)
    └── browser-host.ts   Browser-side MCPHost (zero Node deps)
demo/
├── tool-host.ts          Server-side demo (counter + todo)
└── web/                  Browser demo (Vite + counter + todo)
scripts/
├── gen-cert.sh           Generate self-signed TLS certs
├── smoke-test.ts         Raw WebSocket client smoke test
└── smoke-agent.ts        End-to-end integration test
```

## License

MIT
