// 轻量日志器：默认写文件，避免 console.log 污染 opencode TUI
// 行为由 WEBMCP_LOG_FILE 环境变量控制：
//   未设置 / "file"   → 写文件到 <cwd>/.opencode/logs/webmcp-polyfill.log
//   "stderr" / "stdout" → 走对应标准流（配合 opencode --print-logs 调试用）
//   "off" / "none" / ""  → 完全静默
//   其他字符串        → 当作自定义文件路径
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const DEFAULT_LOG_FILE = ".opencode/logs/webmcp-polyfill.log";

export function createLogger(scope: string): Logger {
  const cfg = (process.env.WEBMCP_LOG_FILE ?? DEFAULT_LOG_FILE).trim();

  // 静默模式
  if (!cfg || cfg === "off" || cfg === "none") {
    return { info() {}, warn() {}, error() {} };
  }

  // 文件模式：预创建目录
  const isFile = cfg !== "stderr" && cfg !== "stdout";
  if (isFile) {
    try {
      mkdirSync(dirname(resolve(cfg)), { recursive: true });
    } catch {
      // 目录创建失败不阻断，写入失败会在每次调用时静默吞掉
    }
  }

  const write = (level: LogLevel, message: string): void => {
    const line = `${new Date().toISOString()} [${scope}] ${level}: ${message}\n`;
    if (cfg === "stderr") {
      process.stderr.write(line);
    } else if (cfg === "stdout") {
      process.stdout.write(line);
    } else {
      try {
        appendFileSync(resolve(cfg), line, { flag: "a" });
      } catch {
        // 写入失败静默，日志不能影响业务
      }
    }
  };

  return {
    info: (m) => write("INFO", m),
    warn: (m) => write("WARN", m),
    error: (m) => write("ERROR", m),
  };
}
