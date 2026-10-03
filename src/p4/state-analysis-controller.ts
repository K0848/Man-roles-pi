import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type StateAnalysisEvent =
  | { type: "state-analysis-claimed"; operationId: string; attempt: number; createdAt: number }
  | { type: "state-analysis-completed"; operationId: string; attempt: number; result: string; createdAt: number }
  | { type: "state-analysis-failed"; operationId: string; attempt: number; reason: string; createdAt: number };

/** Detached state-analysis operation; it never rewrites a completed persona turn. */
export class StateAnalysisController {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "state-analysis-events.jsonl");
  }

  async run(operationId: string, analyze: () => Promise<string>): Promise<StateAnalysisEvent> {
    const attempt = (await this.read()).filter((event) => event.operationId === operationId && event.type === "state-analysis-claimed").length + 1;
    await this.append({ type: "state-analysis-claimed", operationId, attempt, createdAt: Date.now() });
    try {
      const result = await analyze();
      const completed: StateAnalysisEvent = { type: "state-analysis-completed", operationId, attempt, result, createdAt: Date.now() };
      await this.append(completed);
      return completed;
    } catch (error) {
      const failed: StateAnalysisEvent = { type: "state-analysis-failed", operationId, attempt, reason: error instanceof Error ? error.message : String(error), createdAt: Date.now() };
      await this.append(failed);
      return failed;
    }
  }

  read(): Promise<StateAnalysisEvent[]> {
    return this.load();
  }

  private async load(): Promise<StateAnalysisEvent[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as StateAnalysisEvent);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  private async append(event: StateAnalysisEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
