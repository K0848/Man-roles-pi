import type { Api, Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { P2Host, type P2TurnInput } from "../p2/host.js";
import { SharedStateRepository, type SharedStateEvent } from "./shared-state-repository.js";

export type P3TurnInput = P2TurnInput;

/** P3 host that projects only current confirmed shared state into a persona request. */
export class P3Host {
  private readonly states: SharedStateRepository;
  private readonly personas: P2Host;

  constructor(dataDir: string) {
    this.states = new SharedStateRepository(dataDir);
    this.personas = new P2Host(dataDir);
  }

  async writeState(event: SharedStateEvent): Promise<void> {
    await this.states.append(event);
  }

  async currentState(): Promise<SharedStateEvent[]> {
    return this.states.current();
  }

  async runTurn(input: P3TurnInput) {
    const current = await this.states.current();
    return this.personas.runTurn({
      ...input,
      contextMessages: current.map((item) => `共享状态 ${item.itemId} revision=${item.revision}: ${item.text}`),
      contextSourceEventIds: current.flatMap((item) => [item.itemId, ...item.sourceEventIds]),
    });
  }
}

export type P3Model = Model<Api>;
export type P3StreamFn = StreamFn;
