import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ChoiceEvent =
  | { type: "choice-pending"; operationId: string; personaId: string; question: string; createdAt: number }
  | { type: "choice-answered"; operationId: string; answers: string[]; createdAt: number }
  | { type: "choice-cancelled"; operationId: string; createdAt: number };

/** P4 waiting-user state machine with terminal idempotency. */
export class ChoiceController {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "choice-events.jsonl");
  }

  async ask(operationId: string, personaId: string, question: string): Promise<ChoiceEvent> {
    const existing = await this.terminal(operationId);
    if (existing !== undefined) return existing;
    const pending: ChoiceEvent = { type: "choice-pending", operationId, personaId, question, createdAt: Date.now() };
    await this.append(pending);
    return pending;
  }

  async answer(operationId: string, answers: string[]): Promise<ChoiceEvent> {
    const existing = await this.terminal(operationId);
    if (existing !== undefined) return existing;
    const result: ChoiceEvent = { type: "choice-answered", operationId, answers: [...answers], createdAt: Date.now() };
    await this.append(result);
    return result;
  }

  async cancel(operationId: string): Promise<ChoiceEvent> {
    const existing = await this.terminal(operationId);
    if (existing !== undefined) return existing;
    const result: ChoiceEvent = { type: "choice-cancelled", operationId, createdAt: Date.now() };
    await this.append(result);
    return result;
  }

  async read(): Promise<ChoiceEvent[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as ChoiceEvent);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  private async terminal(operationId: string): Promise<ChoiceEvent | undefined> {
    const events = await this.read();
    return events.find((event) => event.operationId === operationId && (event.type === "choice-answered" || event.type === "choice-cancelled"));
  }

  private async append(event: ChoiceEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
