import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ExecutionEvent = {
  type: "execution-claimed" | "execution-cancelling" | "execution-cancelled" | "execution-completed" | "execution-failed";
  operationId: string;
  createdAt: number;
  details?: Record<string, unknown>;
};

/** P4 append-only execution state used to separate control state from answer state. */
export class ExecutionRepository {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "execution-events.jsonl");
  }

  async append(event: ExecutionEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
  }

  async read(): Promise<ExecutionEvent[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as ExecutionEvent);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
