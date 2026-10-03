import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SessionLogEntry = {
  type: string;
  operationId: string;
  payload?: unknown;
  createdAt: number;
};

/**
 * P1's inspectable JSONL execution log adapter.
 *
 * This is intentionally small and owned by the application. P5 will evaluate
 * Pi's storage-backed session repository before selecting the final backend.
 */
export class JsonlSessionLog {
  private readonly path: string;

  constructor(dataDir: string, sessionId: string) {
    this.path = join(dataDir, "sessions", `${sessionId}.jsonl`);
  }

  async append(entry: SessionLogEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async read(): Promise<SessionLogEntry[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as SessionLogEntry);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
