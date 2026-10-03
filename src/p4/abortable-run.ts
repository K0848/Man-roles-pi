import type { AssistantMessage, Api, Model } from "@earendil-works/pi-ai";
import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";

export type ExecutionState = "idle" | "running" | "stopping" | "stopped" | "cancelled" | "failed" | "unknown";

export type AbortableRunInput = {
  model: Model<Api>;
  streamFn: StreamFn;
  prompt: string;
};

/**
 * P4 technical abort seam.
 *
 * This isolates Pi's request cancellation from the later Product Host
 * cancellation protocol; accepted/cancelled linearization is still a P4 task.
 */
export class AbortablePiRun {
  private stateValue: ExecutionState = "idle";
  private agent: Agent | undefined;
  private runPromise: Promise<void> | undefined;

  get state(): ExecutionState {
    return this.stateValue;
  }

  start(input: AbortableRunInput): Promise<void> {
    if (this.stateValue !== "idle") throw new Error(`run cannot start from ${this.stateValue}`);
    this.stateValue = "running";
    this.agent = new Agent({
      streamFn: input.streamFn,
      initialState: { model: input.model, systemPrompt: "P4 abort probe", tools: [] },
    });
    this.runPromise = this.agent.prompt(input.prompt)
      .then(() => this.agent?.waitForIdle())
      .then(() => {
        if (this.stateValue === "running") this.stateValue = "stopped";
        else if (this.stateValue === "stopping") this.stateValue = "cancelled";
      })
      .catch(() => {
        if (this.stateValue === "stopping") this.stateValue = "cancelled";
        else if (this.stateValue === "running") this.stateValue = "failed";
      });
    return this.runPromise;
  }

  async cancel(): Promise<void> {
    if (this.stateValue !== "running") return;
    this.stateValue = "stopping";
    this.agent?.abort();
    await this.runPromise;
    if (this.stateValue === "stopping") this.stateValue = "unknown";
  }
}

export type AbortProbeMessage = AssistantMessage;
