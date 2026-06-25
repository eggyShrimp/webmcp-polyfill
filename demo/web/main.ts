import { BrowserMCPHost } from "../../src/sdk/browser-host";

// ===== 内存状态 =====
let counter = 0;
let todos: string[] = [];

// ===== UI 元素 =====
const $status = document.getElementById("status")!;
const $counter = document.getElementById("counter")!;
const $todoList = document.getElementById("todo-list")!;
const $todoText = document.getElementById("todo-text") as HTMLInputElement;
const $addBtn = document.getElementById("add-btn")!;
const $log = document.getElementById("log")!;

function setStatus(s: "connecting" | "connected" | "disconnected"): void {
  $status.textContent = s;
  $status.className = `status ${s}`;
}

function render(): void {
  $counter.textContent = String(counter);
  $todoList.innerHTML = "";
  todos.forEach((t, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(t)}</span><button data-idx="${i}">删除</button>`;
    li.querySelector("button")!.addEventListener("click", () => {
      todos.splice(i, 1);
      render();
    });
    $todoList.appendChild(li);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function log(message: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  $log.textContent = line + "\n" + $log.textContent;
}

$addBtn.addEventListener("click", () => {
  const text = $todoText.value.trim();
  if (!text) return;
  todos.push(text);
  $todoText.value = "";
  render();
});
$todoText.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $addBtn.click();
});

render();

// ===== BrowserMCPHost：注册 tools / resources / prompts =====
const host = new BrowserMCPHost({
  url: "ws://localhost:3098",
  reconnectInterval: 2000,
  meta: "web",
});

host.onStatus(setStatus);

// tools
host.tool("counter_increment", {
  description: "计数器 +1，返回新值",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    counter++;
    render();
    log("counter_increment → " + counter);
    return { count: counter };
  },
});

host.tool("counter_decrement", {
  description: "计数器 -1，返回新值",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    counter--;
    render();
    log("counter_decrement → " + counter);
    return { count: counter };
  },
});

host.tool("counter_get", {
  description: "获取当前计数",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    log("counter_get");
    return { count: counter };
  },
});

host.tool("todo_add", {
  description: "添加待办事项",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "待办内容" } },
    required: ["text"],
  },
  execute: async (args) => {
    const text = String(args.text);
    todos.push(text);
    render();
    log(`todo_add("${text}")`);
    return { todos };
  },
});

host.tool("todo_list", {
  description: "列出所有待办",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    log("todo_list");
    return { todos };
  },
});

host.tool("todo_remove", {
  description: "删除待办事项",
  inputSchema: {
    type: "object",
    properties: { index: { type: "integer", description: "待办索引" } },
    required: ["index"],
  },
  execute: async (args) => {
    const idx = Number(args.index);
    todos.splice(idx, 1);
    render();
    log(`todo_remove(${idx})`);
    return { todos };
  },
});

// resources
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

// prompts
host.prompt("counter_summary", {
  description: "生成计数器状态总结",
  arguments: [
    { name: "style", description: "总结风格", required: false },
  ],
  get: async (args) => {
    const style = (args.style as string) ?? "默认";
    log(`counter_summary(style="${style}")`);
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

// ===== 连接 =====
host.connect().then(
  () => log("已连接到 plugin"),
  (err) => log("连接失败：" + (err as Error).message)
);
