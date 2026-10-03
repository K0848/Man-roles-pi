import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Context } from "@earendil-works/pi-agent-core";

type DeleteEvent = { operationId: string; type: "delete-requested" | "session-deleted"; sessionId?: string; createdAt: number };

export type DeletableSession<TMetadata extends { id: string }> = {
  delete(metadata: TMetadata, context: Context): Promise<void>;
};

/** P5 checkpointed deletion over an official Session repository. */
export class DeleteCheckpoint<TMetadata extends { id: string }> {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "delete-events.jsonl");
  }

  async run(operationId: string, repo: DeletableSession<TMetadata>, targets: readonly TMetadata[], context: Context, failAfter?: number): Promise<void> {
    const prior = await this.read();
    const completed = new Set(prior.filter((event) => event.operationId === operationId && event.type === "session-deleted").map((event) => event.sessionId));
    if (!prior.some((event) => event.operationId === operationId && event.type === "delete-requested")) {
      await this.append({ operationId, type: "delete-requested", createdAt: Date.now() });
    }
    let deletedThisRun = 0;
    for (const target of targets) {
      if (completed.has(target.id)) continue;
      await repo.delete(target, context);
      await this.append({ operationId, type: "session-deleted", sessionId: target.id, createdAt: Date.now() });
      deletedThisRun += 1;
      if (failAfter !== undefined && deletedThisRun >= failAfter) throw new Error("injected deletion interruption");
    }
  }

  async read(): Promise<DeleteEvent[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as DeleteEvent);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  private async append(event: DeleteEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
