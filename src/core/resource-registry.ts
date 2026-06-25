import type { ResourceDef, ResourceReader, ReadResourceResult } from "./types.js";
import { ERROR_CODES, JsonRpcError } from "./types.js";

interface RegisteredResource {
  def: ResourceDef;
  reader: ResourceReader;
}

export class ResourceRegistry {
  private resources = new Map<string, RegisteredResource>();

  register(
    uri: string,
    name: string,
    mimeType: string | undefined,
    reader: ResourceReader
  ): void {
    this.resources.set(uri, {
      def: { uri, name, mimeType },
      reader,
    });
  }

  list(): ResourceDef[] {
    return Array.from(this.resources.values()).map((r) => r.def);
  }

  async read(uri: string): Promise<ReadResourceResult> {
    const resource = this.resources.get(uri);
    if (!resource) {
      throw new JsonRpcError(
        ERROR_CODES.INVALID_PARAMS,
        `Resource not found: ${uri}`
      );
    }
    const raw = await resource.reader();
    const entry = this.normalizeReaderResult(raw, uri, resource.def.mimeType);
    return { contents: [entry] };
  }

  private normalizeReaderResult(
    raw: Awaited<ReturnType<ResourceReader>>,
    uri: string,
    mimeType: string | undefined
  ): ReadResourceResult["contents"][number] {
    if (typeof raw === "string") {
      return { uri, mimeType, text: raw };
    }
    return { uri, mimeType, ...raw };
  }
}
