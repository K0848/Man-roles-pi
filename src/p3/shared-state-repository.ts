import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SharedStateEvent = {
  type: "shared-state";
  operationId: string;
  itemId: string;
  status: "confirmed" | "superseded" | "withdrawn";
  text: string;
  sourceEventIds: string[];
  revision: number;
  createdAt: number;
};

/** P3 shared-state event log and deterministic current projection. */
export class SharedStateRepository {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "shared-state.jsonl");
  }

  async append(event: SharedStateEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
  }

  async readEvents(): Promise<SharedStateEvent[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as SharedStateEvent);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  async current(): Promise<SharedStateEvent[]> {
    const events = await this.readEvents();
    const latest = new Map<string, SharedStateEvent>();
    for (const event of events) {
      const prior = latest.get(event.itemId);
      if (prior === undefined || event.revision >= prior.revision) latest.set(event.itemId, event);
    }
    return [...latest.values()].filter((event) => event.status === "confirmed").sort((a, b) => a.revision - b.revision);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
