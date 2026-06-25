import { MCPClient } from "../src/adapter/mcp-client";

const client = new MCPClient("ws://localhost:3099", {
  connectTimeout: 3000,
  requestTimeout: 5000,
});

await client.connect();
console.log("[smoke] connected");

// tools/list
const { tools } = (await client.send("tools/list")) as { tools: { name: string }[] };
console.log("[smoke] tools:", tools.map((t) => t.name).join(", "));

// tools/call: counter_increment
const r1 = await client.send("tools/call", {
  name: "counter_increment",
  arguments: {},
});
console.log("[smoke] counter_increment:", JSON.stringify(r1));

// resources/list — 现在通过桥接 tool 访问
const r0 = (await client.send("tools/call", {
  name: "webmcp_resources_list",
  arguments: {},
})) as { content: { text: string }[] };
console.log("[smoke] resources_list:", r0.content?.[0]?.text ?? JSON.stringify(r0));

// resources/read — 通过桥接 tool
const r2 = (await client.send("tools/call", {
  name: "webmcp_resources_read",
  arguments: { uri: "app://counter/value" },
})) as { content: { text: string }[] };
console.log("[smoke] read counter:", r2.content?.[0]?.text ?? JSON.stringify(r2));

// prompts/list — 通过桥接 tool
const r4 = (await client.send("tools/call", {
  name: "webmcp_prompts_list",
  arguments: {},
})) as { content: { text: string }[] };
console.log("[smoke] prompts_list:", r4.content?.[0]?.text ?? JSON.stringify(r4));

// prompts/get — 通过桥接 tool
const r3 = (await client.send("tools/call", {
  name: "webmcp_prompts_get",
  arguments: { name: "counter_summary", arguments: { style: "幽默" } },
})) as { content: { text: string }[] };
console.log("[smoke] prompt_get:", r3.content?.[0]?.text ?? JSON.stringify(r3));

await client.close();
console.log("[smoke] done");
