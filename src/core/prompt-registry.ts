import type {
  PromptDef,
  PromptGetter,
  GetPromptResult,
  TextContent,
} from "./types.js";
import { ERROR_CODES, JsonRpcError } from "./types.js";

export interface PromptRegisterOptions {
  description: string;
  arguments?: PromptDef["arguments"];
  get: PromptGetter;
}

interface RegisteredPrompt {
  def: PromptDef;
  getter: PromptGetter;
}

export class PromptRegistry {
  private prompts = new Map<string, RegisteredPrompt>();

  register(name: string, options: PromptRegisterOptions): void {
    this.prompts.set(name, {
      def: {
        name,
        description: options.description,
        arguments: options.arguments,
      },
      getter: options.get,
    });
  }

  list(): PromptDef[] {
    return Array.from(this.prompts.values()).map((p) => p.def);
  }

  async get(name: string, args: Record<string, unknown>): Promise<GetPromptResult> {
    const prompt = this.prompts.get(name);
    if (!prompt) {
      throw new JsonRpcError(
        ERROR_CODES.INVALID_PARAMS,
        `Prompt not found: ${name}`
      );
    }
    const messages = await prompt.getter(args);
    return {
      messages: messages.map((m) => ({
        role: m.role,
        content: this.normalizeContent(m.content),
      })),
    };
  }

  private normalizeContent(content: unknown): TextContent {
    if (
      content &&
      typeof content === "object" &&
      "type" in (content as Record<string, unknown>) &&
      (content as { type: unknown }).type === "text"
    ) {
      return content as TextContent;
    }
    // 裸字符串自动包装
    return { type: "text", text: String(content) };
  }
}
