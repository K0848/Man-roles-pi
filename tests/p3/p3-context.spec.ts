import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AssistantMessage, JsonObject, TranscriptContext } from "@earendil-works/pi-ai";
import { P3Host } from "../../src/p3/host.js";

const model = {
  id: "p3-fake", name: "p3-fake", api: "fake-api", provider: "fake", baseUrl: "http://p3.invalid",
  reasoning: false, input: ["text"] as ("text" | "image")[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 256,
};
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

describe("P3 shared state projection", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it("projects the current state and removes superseded state from actual provider context", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p3-"));
    roots.push(root);
    const contexts: TranscriptContext[] = [];
    const streamFn = (_model: typeof model, context: TranscriptContext) => {
      contexts.push(structuredClone(context));
      const response: AssistantMessage = {
        role: "assistant", content: [{ type: "toolCall", id: `submit-${contexts.length}`, name: "persona_turn_submit", arguments: { text: "基于当前状态给出一个小行动。", evidenceIds: ["e1"] } as JsonObject }],
        api: model.api, provider: model.provider, model: model.id, usage, stopReason: "toolUse", timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: response });
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: response });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: response.content[0] as Extract<AssistantMessage["content"][number], { type: "toolCall" }>, partial: response });
        stream.push({ type: "done", reason: "toolUse", message: response });
        stream.end();
      });
      return stream;
    };

    const host = new P3Host(root);
    await host.writeState({ type: "shared-state", operationId: "state-a", itemId: "goal", status: "confirmed", text: "A 状态", sourceEventIds: ["u-a"], revision: 1, createdAt: Date.now() });
    await host.runTurn({ dataDir: root, dilemmaId: "d1", personaId: "wang-yangming", operationId: "turn-a", messageId: "msg-a", text: "A 的问题", model, streamFn });
    await host.writeState({ type: "shared-state", operationId: "state-a-supersede", itemId: "goal", status: "superseded", text: "A 状态", sourceEventIds: ["u-a"], revision: 2, createdAt: Date.now() });
    await host.writeState({ type: "shared-state", operationId: "state-b", itemId: "goal", status: "confirmed", text: "B 状态", sourceEventIds: ["u-b"], revision: 2, createdAt: Date.now() });
    await host.runTurn({ dataDir: root, dilemmaId: "d1", personaId: "zeng-guofan", operationId: "turn-b", messageId: "msg-b", text: "B 的问题", model, streamFn });

    expect(JSON.stringify(contexts[0])).toContain("A 状态");
    expect(JSON.stringify(contexts[1])).toContain("B 状态");
    expect(JSON.stringify(contexts[1])).not.toContain("A 状态");
  });
});
