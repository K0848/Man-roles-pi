import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AssistantMessage, JsonObject, TranscriptContext } from "@earendil-works/pi-ai";
import { JsonlSessionLog } from "../../src/p1/session-log.js";
import { P2Host } from "../../src/p2/host.js";
import type { P2TurnInput } from "../../src/p2/host.js";

const model: P2TurnInput["model"] = {
  id: "p2-fake",
  name: "p2-fake",
  api: "fake-api",
  provider: "fake",
  baseUrl: "http://p2.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 256,
} as const;

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (text: string, callId: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "toolCall", id: callId, name: "persona_turn_submit", arguments: { text, evidenceIds: ["e1"] } as JsonObject }],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage,
  stopReason: "toolUse",
  timestamp: Date.now(),
});

describe("P2 multi-persona branch isolation", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it("creates/reuses stable branches and keeps execution logs private", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p2-"));
    roots.push(root);
    const contexts = new Map<string, TranscriptContext[]>();
    const streamFn = (providerModel: typeof model, context: TranscriptContext) => {
      const label = String(context.messages.find((message) => message.role === "user")?.content ?? "unknown");
      const captured = contexts.get(label) ?? [];
      captured.push(structuredClone(context));
      contexts.set(label, captured);
      const stream = createAssistantMessageEventStream();
      const response = assistant(`${label} 的独立回答`, `submit-${label}`);
      queueMicrotask(() => {
        stream.push({ type: "start", partial: response });
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: response });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: response.content[0] as Extract<AssistantMessage["content"][number], { type: "toolCall" }>, partial: response });
        stream.push({ type: "done", reason: "toolUse", message: response });
        stream.end();
      });
      return stream;
    };

    const host = new P2Host(root);
    const wang = await host.ensurePersona("d1", "wang-yangming", "branch-a");
    const wangAgain = await host.ensurePersona("d1", "wang-yangming", "branch-a-retry");
    const zeng = await host.ensurePersona("d1", "zeng-guofan", "branch-b");
    expect(wang.sessionId).toBe(wangAgain.sessionId);
    expect(zeng.sessionId).not.toBe(wang.sessionId);
    expect((await host.readBranches()).filter((event) => event.type === "branch-added")).toHaveLength(2);

    const base = { dataDir: root, dilemmaId: "d1", model, streamFn };
    const first = await host.runTurn({ ...base, personaId: "wang-yangming", operationId: "turn-a", messageId: "msg-a", text: "A only" });
    const second = await host.runTurn({ ...base, personaId: "zeng-guofan", operationId: "turn-b", messageId: "msg-b", text: "B only" });
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("accepted");
    expect((await new JsonlSessionLog(root, wang.sessionId).read()).some((event) => JSON.stringify(event).includes("A only"))).toBe(true);
    expect((await new JsonlSessionLog(root, zeng.sessionId).read()).some((event) => JSON.stringify(event).includes("B only"))).toBe(true);
    expect((await new JsonlSessionLog(root, zeng.sessionId).read()).some((event) => JSON.stringify(event).includes("A only"))).toBe(false);
  });
});
