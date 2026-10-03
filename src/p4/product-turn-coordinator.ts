import type { AbortableRunInput, ExecutionState } from "./abortable-run.js";
import { ManagedTurn } from "./managed-turn.js";
import { JsonlProductRepository, type ProductEvent } from "../p1/product-repository.js";

export type CoordinatorInput = {
  dataDir: string;
  dilemmaId: string;
  personaId: string;
  messageId: string;
  operationId: string;
  run: AbortableRunInput;
};

/** P4 Product Host seam that linearizes accepted vs cancelled outcomes. */
export class ProductTurnCoordinator {
  private readonly products: JsonlProductRepository;
  private readonly active = new Map<string, ManagedTurn>();

  constructor(dataDir: string) {
    this.products = new JsonlProductRepository(dataDir);
  }

  async start(input: CoordinatorInput): Promise<void> {
    const existing = await this.products.findTerminal(input.operationId);
    if (existing !== undefined) return;
    const managed = new ManagedTurn(input.dataDir);
    this.active.set(input.operationId, managed);
    try {
      await managed.start(input.operationId, input.run);
      if (managed.state === "stopped") {
        await this.products.appendTerminalOnce({
          type: "accepted-turn",
          operationId: input.operationId,
          dilemmaId: input.dilemmaId,
          personaId: input.personaId,
          text: "P4 accepted placeholder",
          evidenceIds: [],
          createdAt: Date.now(),
        });
      }
    } finally {
      this.active.delete(input.operationId);
    }
  }

  async cancel(input: Pick<CoordinatorInput, "operationId" | "dilemmaId" | "personaId" | "messageId">): Promise<ProductEvent | undefined> {
    const existing = await this.products.findTerminal(input.operationId);
    if (existing !== undefined) return existing;
    const managed = this.active.get(input.operationId);
    if (managed === undefined) return undefined;
    await managed.cancel(input.operationId);
    if (managed.state !== "cancelled") return undefined;
    return this.products.appendTerminalOnce({
      type: "cancelled-turn",
      operationId: input.operationId,
      dilemmaId: input.dilemmaId,
      personaId: input.personaId,
      messageId: input.messageId,
      reason: "user-cancelled",
      createdAt: Date.now(),
    });
  }

  async terminal(operationId: string): Promise<ProductEvent | undefined> {
    return this.products.findTerminal(operationId);
  }

  async executionState(operationId: string): Promise<ExecutionState | "idle"> {
    return this.active.get(operationId)?.state ?? "idle";
  }
}
