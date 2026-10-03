import type { AssistantMessage, AssistantMessageEventStream, Model, Api } from "@earendil-works/pi-ai";
import { Agent, type AgentTool, type AgentEvent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { JsonlProductRepository, type ProductEvent } from "./product-repository.js";
import { JsonlSessionLog } from "./session-log.js";

const submitParameters = Type.Object({
  text: Type.String({ minLength: 1 }),
  evidenceIds: Type.Array(Type.String(), { minItems: 1 }),
});
const lookupParameters = Type.Object({ topic: Type.String({ minLength: 1 }) });

type SubmitParameters = { text: string; evidenceIds: string[] };

export type P1TurnInput = {
  dataDir: string;
  dilemmaId: string;
  personaId: string;
  sessionId?: string;
  operationId: string;
  messageId: string;
  text: string;
  contextMessages?: string[];
  contextSourceEventIds?: string[];
  model: Model<Api>;
  streamFn: StreamFn;
};

export type P1TurnResult = {
  status: "accepted";
  operationId: string;
  text: string;
  evidenceIds: string[];
  reused: boolean;
};

/**
 * Product Host for the first Pi vertical slice.
 *
 * The Host persists the user message before starting Pi, exposes only two
 * product tools, and accepts a turn only through the structured submit tool.
 */
export class P1Host {
  async runTurn(input: P1TurnInput): Promise<P1TurnResult> {
    const products = new JsonlProductRepository(input.dataDir);
    const prior = await products.findAccepted(input.operationId);
    if (prior !== undefined) {
      return { status: "accepted", ...prior, reused: true };
    }

    await products.appendOnce({
      type: "user-message",
      operationId: input.operationId,
      dilemmaId: input.dilemmaId,
      personaId: input.personaId,
      messageId: input.messageId,
      text: input.text,
      createdAt: Date.now(),
    });

    const session = new JsonlSessionLog(input.dataDir, input.sessionId ?? input.personaId);
    let accepted: Extract<ProductEvent, { type: "accepted-turn" }> | undefined;
    let providerRequestCount = 0;
    const pendingSessionWrites: Promise<void>[] = [];
    const lookupTool: AgentTool<typeof lookupParameters> = {
      name: "evidence_lookup",
      label: "evidence_lookup",
      description: "Look up one fixed, authorized evidence item for the current persona.",
      parameters: lookupParameters,
      execute: async () => ({
        content: [{ type: "text", text: "evidenceId=e1：事上磨练（P1 fake evidence）" }],
        details: { evidenceIds: ["e1"], personaId: input.personaId },
      }),
    };
    const submitTool: AgentTool<typeof submitParameters> = {
      name: "persona_turn_submit",
      label: "persona_turn_submit",
      description: "Submit one structured accepted answer for the current turn.",
      parameters: submitParameters,
      execute: async (_toolCallId, params) => {
        const typed = params as SubmitParameters;
        if (!typed.evidenceIds.every((evidenceId) => evidenceId === "e1")) {
          throw new Error("P1 evidence id is outside the current capability");
        }
        const event = await products.appendOnce({
          type: "accepted-turn",
          operationId: input.operationId,
          dilemmaId: input.dilemmaId,
          personaId: input.personaId,
          text: typed.text,
          evidenceIds: typed.evidenceIds,
          createdAt: Date.now(),
        });
        if (event.type !== "accepted-turn") throw new Error("P1 accepted event was replaced by another product event");
        accepted = event;
        return {
          content: [{ type: "text", text: "accepted" }],
          details: { operationId: input.operationId },
          terminate: true,
        };
      },
    };

    const agent = new Agent({
      streamFn: input.streamFn,
      initialState: {
        model: input.model,
        systemPrompt: [
          `You are ${input.personaId}.`,
          "This is a product turn, not a free-form chat response.",
          "You MUST first call evidence_lookup for one relevant topic.",
          "After the lookup returns, you MUST call persona_turn_submit with a concise answer and only the evidenceIds returned by that lookup.",
          "Do not finish with ordinary assistant text; the turn is complete only after persona_turn_submit succeeds.",
        ].join(" "),
        tools: [lookupTool, submitTool],
        messages: (input.contextMessages ?? []).map((message) => ({ role: "user", content: message, timestamp: Date.now() })),
      },
      toolExecution: "sequential",
      prepareRequest: async () => {
        providerRequestCount += 1;
        await session.append({
          type: "provider-request",
          operationId: input.operationId,
          payload: {
            requestIndex: providerRequestCount,
            inputManifest: {
              dilemmaId: input.dilemmaId,
              personaId: input.personaId,
              operationId: input.operationId,
              sourceEventIds: [input.messageId, ...(input.contextSourceEventIds ?? [])],
              excludedSources: [],
              contextFingerprint: `p1:${input.operationId}:${input.messageId}`,
            },
          },
          createdAt: Date.now(),
        });
      },
    });
    agent.subscribe((event: AgentEvent) => {
      const write = session.append({
        type: event.type,
        operationId: input.operationId,
        payload: event.type === "message_end" ? event.message : event.type === "agent_end" ? event.messages : undefined,
        createdAt: Date.now(),
      });
      pendingSessionWrites.push(write);
      return write;
    });

    await agent.prompt(input.text);
    await agent.waitForIdle();
    await Promise.all(pendingSessionWrites);
    if (accepted === undefined) throw new Error("P1 Agent ended without accepted persona_turn_submit");
    return { status: "accepted", ...accepted, reused: false };
  }
}

export type P1Model = Model<Api>;
export type P1AssistantMessage = AssistantMessage;
export type P1AssistantStream = AssistantMessageEventStream;
export type P1AgentMessage = AgentMessage;
