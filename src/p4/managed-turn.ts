import { AbortablePiRun, type AbortableRunInput, type ExecutionState } from "./abortable-run.js";
import { ExecutionRepository } from "./execution-repository.js";

/** P4 control wrapper for cancellation linearization around a Pi run. */
export class ManagedTurn {
  private readonly repository: ExecutionRepository;
  private readonly run: AbortablePiRun;
  private startPromise: Promise<void> | undefined;
  private cancelPromise: Promise<void> | undefined;
  private terminalWritten = false;

  constructor(dataDir: string, run = new AbortablePiRun()) {
    this.repository = new ExecutionRepository(dataDir);
    this.run = run;
  }

  get state(): ExecutionState {
    return this.run.state;
  }

  async start(operationId: string, input: AbortableRunInput): Promise<void> {
    if (this.startPromise !== undefined) throw new Error("turn already started");
    await this.repository.append({ type: "execution-claimed", operationId, createdAt: Date.now() });
    this.startPromise = this.run.start(input).then(async () => {
      const terminal = this.run.state === "cancelled" ? "execution-cancelled" : this.run.state === "failed" ? "execution-failed" : "execution-completed";
      await this.repository.append({ type: terminal, operationId, createdAt: Date.now(), details: { state: this.run.state } });
      this.terminalWritten = true;
    });
    await this.startPromise;
  }

  async cancel(operationId: string): Promise<void> {
    if (this.cancelPromise !== undefined) return this.cancelPromise;
    this.cancelPromise = (async () => {
      if (this.startPromise === undefined) return;
      if (this.terminalWritten) return;
      await this.repository.append({ type: "execution-cancelling", operationId, createdAt: Date.now() });
      await this.run.cancel();
      await this.startPromise;
    })();
    return this.cancelPromise;
  }

  readEvents() {
    return this.repository.read();
  }
}
