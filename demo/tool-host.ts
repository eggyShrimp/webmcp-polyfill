import { MCPHost } from "../src/sdk/host";

const host = new MCPHost({ port: 3099 });

// 内存状态
let counter = 0;
let todos: string[] = [];

// ===== Tools =====

host.tool("counter_increment", {
  description: "计数器 +1，返回新值",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    counter++;
    return { count: counter };
  },
});

host.tool("counter_decrement", {
  description: "计数器 -1，返回新值",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    counter--;
    return { count: counter };
  },
});

host.tool("counter_get", {
  description: "获取当前计数",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    return { count: counter };
  },
});

host.tool("todo_add", {
  description: "添加待办事项",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "待办内容" },
    },
    required: ["text"],
  },
  execute: async (args) => {
    const text = String(args.text);
    todos.push(text);
    return { todos };
  },
});

host.tool("todo_list", {
  description: "列出所有待办",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    return { todos };
  },
});

host.tool("todo_remove", {
  description: "删除待办事项",
  inputSchema: {
    type: "object",
    properties: {
      index: { type: "integer", description: "待办索引" },
    },
    required: ["index"],
  },
  execute: async (args) => {
    const idx = Number(args.index);
    todos.splice(idx, 1);
    return { todos };
  },
});

// ===== Resources =====

host.resource("app://counter/value", {
  name: "计数器当前值",
  mimeType: "text/plain",
  read: async () => String(counter),
});

host.resource("app://todos/list", {
  name: "待办列表",
  mimeType: "application/json",
  read: async () => JSON.stringify(todos),
});

// ===== Prompts =====

host.prompt("counter_summary", {
  description: "生成计数器状态总结",
  arguments: [
    { name: "style", description: "总结风格", required: false },
  ],
  get: async (args) => {
    const style = (args.style as string) ?? "默认";
    return [
      {
        role: "user",
        content: {
          type: "text",
          text: `当前计数是 ${counter}（风格：${style}），请评价这个数字`,
        },
      },
    ];
  },
});

// ===== 启动 =====

await host.listen();
console.log("[demo] webmcp-polyfill host listening on ws://localhost:3099 (plain; pass certPath/keyPath for WSS)");
console.log("[demo] tools: counter_increment/decrement/get, todo_add/list/remove");
console.log("[demo] resources: app://counter/value, app://todos/list");
console.log("[demo] prompts: counter_summary(style?)");
