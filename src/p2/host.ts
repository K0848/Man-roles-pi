import type { Api, Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { P1Host, type P1TurnResult } from "../p1/host.js";
import { BranchRepository, type BranchEvent } from "./branch-repository.js";

export type P2TurnInput = {
  dataDir: string;
  dilemmaId: string;
  personaId: string;
  operationId: string;
  messageId: string;
  text: string;
  contextMessages?: string[];
  contextSourceEventIds?: string[];
  model: Model<Api>;
  streamFn: StreamFn;
};

/** P2 host that gives each persona a stable branch and private Pi execution log. */
export class P2Host {
  private readonly branches: BranchRepository;
  private readonly p1 = new P1Host();

  constructor(dataDir: string) {
    this.branches = new BranchRepository(dataDir);
  }

  async ensurePersona(dilemmaId: string, personaId: string, operationId: string): Promise<Extract<BranchEvent, { type: "branch-added" }>> {
    return this.branches.ensureBranch(dilemmaId, personaId, operationId);
  }

  async runTurn(input: P2TurnInput): Promise<P1TurnResult> {
    const branch = await this.ensurePersona(input.dilemmaId, input.personaId, `branch:${input.dilemmaId}:${input.personaId}`);
    return this.p1.runTurn({ ...input, sessionId: branch.sessionId });
  }

  readBranches(): Promise<BranchEvent[]> {
    return this.branches.readEvents();
  }
}
