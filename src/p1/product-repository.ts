import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ProductEvent =
  | {
      type: "user-message";
      operationId: string;
      dilemmaId: string;
      personaId: string;
      messageId: string;
      text: string;
      createdAt: number;
    }
  | {
      type: "accepted-turn";
      operationId: string;
      dilemmaId: string;
      personaId: string;
      text: string;
      evidenceIds: string[];
      createdAt: number;
    }
  | {
      type: "cancelled-turn";
      operationId: string;
      dilemmaId: string;
      personaId: string;
      messageId: string;
      reason: string;
      createdAt: number;
    };

/**
 * Minimal append-only product event store used by P1.
 *
 * It owns product facts and idempotency for the vertical slice; the Pi transcript
 * is deliberately stored by a separate session logger.
 */
export class JsonlProductRepository {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "product-events.jsonl");
  }

  async appendOnce(event: ProductEvent): Promise<ProductEvent> {
    const existing = await this.readEvents();
    const prior = existing.find((candidate) => candidate.operationId === event.operationId && candidate.type === event.type);
    if (prior !== undefined) return prior;
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  async readEvents(): Promise<ProductEvent[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as ProductEvent);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  async findAccepted(operationId: string): Promise<Extract<ProductEvent, { type: "accepted-turn" }> | undefined> {
    const events = await this.readEvents();
    const event = events.find((candidate): candidate is Extract<ProductEvent, { type: "accepted-turn" }> =>
      candidate.type === "accepted-turn" && candidate.operationId === operationId,
    );
    return event;
  }

  async findTerminal(operationId: string): Promise<Extract<ProductEvent, { type: "accepted-turn" | "cancelled-turn" }> | undefined> {
    const events = await this.readEvents();
    return events.find((candidate): candidate is Extract<ProductEvent, { type: "accepted-turn" | "cancelled-turn" }> =>
      (candidate.type === "accepted-turn" || candidate.type === "cancelled-turn") && candidate.operationId === operationId,
    );
  }

  async appendTerminalOnce(event: Extract<ProductEvent, { type: "accepted-turn" | "cancelled-turn" }>): Promise<ProductEvent> {
    const prior = await this.findTerminal(event.operationId);
    if (prior !== undefined) return prior;
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
