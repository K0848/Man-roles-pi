import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type BranchEvent =
  | { type: "branch-allocation"; operationId: string; dilemmaId: string; personaId: string; sessionId: string; createdAt: number }
  | { type: "branch-added"; operationId: string; dilemmaId: string; personaId: string; sessionId: string; createdAt: number };

/** P2 branch ownership log; single-process and append-only for this stage. */
export class BranchRepository {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "branches.jsonl");
  }

  async ensureBranch(dilemmaId: string, personaId: string, operationId: string): Promise<Extract<BranchEvent, { type: "branch-added" }>> {
    const events = await this.readEvents();
    const existing = events.find((event): event is Extract<BranchEvent, { type: "branch-added" }> =>
      event.type === "branch-added" && event.dilemmaId === dilemmaId && event.personaId === personaId,
    );
    if (existing !== undefined) return existing;
    const priorAllocation = events.find((event) => event.type === "branch-allocation" && event.operationId === operationId);
    const sessionId = priorAllocation?.sessionId ?? `${dilemmaId}--${personaId}`;
    const allocation: BranchEvent = priorAllocation ?? {
      type: "branch-allocation",
      operationId,
      dilemmaId,
      personaId,
      sessionId,
      createdAt: Date.now(),
    };
    if (priorAllocation === undefined) await this.append(allocation);
    const added: Extract<BranchEvent, { type: "branch-added" }> = {
      type: "branch-added",
      operationId,
      dilemmaId,
      personaId,
      sessionId,
      createdAt: Date.now(),
    };
    await this.append(added);
    return added;
  }

  async readEvents(): Promise<BranchEvent[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as BranchEvent);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  private async append(event: BranchEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
