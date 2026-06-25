import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  // 浏览器中跑的 sdk 不能用 node:tls / node:http / ws 包
  // 通过 alias 把 browser-host 暴露为 sdk 入口，避免引入 server 侧代码
  resolve: {
    alias: {
      // 占位：当前 sdk/host.ts 引入 ws / node 模块，浏览器侧不应直接 import
      // 浏览器 demo 直接 import { BrowserMCPHost } from "../../src/sdk/browser-host"
      // 该文件只依赖 core 的纯 TS registry，没有 node 依赖
    },
  },
  build: {
    target: "es2022",
  },
});
