import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AssistantMessage, JsonObject, TranscriptContext } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { P1Host, type P1Model } from "../../src/p1/host.js";
import { JsonlProductRepository } from "../../src/p1/product-repository.js";
import { JsonlSessionLog } from "../../src/p1/session-log.js";

const model: P1Model = {
  id: "p1-fake",
  name: "p1-fake",
  api: "fake-api",
  provider: "fake",
  baseUrl: "http://p1.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 256,
};

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const assistant = (content: AssistantMessage["content"], stopReason: "toolUse" | "stop"): AssistantMessage => ({
  role: "assistant" as const,
  content,
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage,
  stopReason,
  timestamp: Date.now(),
} as AssistantMessage);

describe("P1 single-persona vertical slice", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("runs Pi Agent → tool → structured submit, persists both facts, and is idempotent after reload", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p1-"));
    roots.push(root);
    let requestCount = 0;
    const providerContexts: TranscriptContext[] = [];
    const streamFn = (_model: P1Model, context: TranscriptContext) => {
      requestCount += 1;
      providerContexts.push(structuredClone(context));
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message = requestCount === 1
          ? assistant([{ type: "toolCall", id: "lookup-1", name: "evidence_lookup", arguments: { topic: "磨练" } as JsonObject }], "toolUse")
          : assistant([{ type: "toolCall", id: "submit-1", name: "persona_turn_submit", arguments: { text: "先查清代价，再用一个小行动验证。", evidenceIds: ["e1"] } as JsonObject }], "toolUse");
        stream.push({ type: "start", partial: message });
        if (message.content[0]?.type === "toolCall") {
          stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
          stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: message.content[0], partial: message });
        }
        stream.push({ type: "done", reason: "toolUse", message });
        stream.end();
      });
      return stream;
    };

    const host = new P1Host();
    const first = await host.runTurn({
      dataDir: root,
      dilemmaId: "d1",
      personaId: "wang-yangming",
      operationId: "op-1",
      messageId: "msg-1",
      text: "我想换工作，但担心收入下降。",
      model,
      streamFn,
    });

    expect(first.status).toBe("accepted");
    expect(first.reused).toBe(false);
    expect(first.evidenceIds).toEqual(["e1"]);
    expect(requestCount).toBe(2);

    const product = new JsonlProductRepository(root);
    const events = await product.readEvents();
    expect(events.filter((event) => event.type === "user-message")).toHaveLength(1);
    expect(events.filter((event) => event.type === "accepted-turn")).toHaveLength(1);

    const session = new JsonlSessionLog(root, "wang-yangming");
    const sessionEvents = await session.read();
    expect(sessionEvents.some((event) => event.type === "tool_execution_start")).toBe(true);
    expect(sessionEvents.some((event) => event.type === "agent_end")).toBe(true);
    const requestEvents = sessionEvents.filter((event) => event.type === "provider-request");
    expect(requestEvents).toHaveLength(2);
    expect((requestEvents[0]?.payload as { inputManifest: { contextFingerprint: string } }).inputManifest.contextFingerprint).toBe("p1:op-1:msg-1");
    expect(JSON.stringify(providerContexts[0])).toContain("我想换工作，但担心收入下降。");
    expect(JSON.stringify(providerContexts[1])).toContain("lookup-1");

    const reloadChild = join(dirname(fileURLToPath(import.meta.url)), "reload-child.ts");
    const reload = spawnSync(process.execPath, ["--import", "tsx/esm", reloadChild, root], { encoding: "utf8" });
    expect(reload.status, reload.stderr).toBe(0);

    const reloaded = new P1Host();
    const replay = await reloaded.runTurn({
      dataDir: root,
      dilemmaId: "d1",
      personaId: "wang-yangming",
      operationId: "op-1",
      messageId: "msg-1",
      text: "我想换工作，但担心收入下降。",
      model,
      streamFn,
    });
    expect(replay.reused).toBe(true);
    expect(requestCount).toBe(2);
    expect((await product.readEvents()).filter((event) => event.type === "accepted-turn")).toHaveLength(1);
  });

  it("does not publish an invalid evidence submission or ordinary assistant text", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p1-negative-"));
    roots.push(root);
    let requestCount = 0;
    const streamFn = (_model: P1Model, _context: unknown) => {
      requestCount += 1;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        if (requestCount === 1) {
          const message = assistant([{ type: "toolCall", id: "submit-invalid", name: "persona_turn_submit", arguments: { text: "伪造证据", evidenceIds: ["outside-capability"] } as JsonObject }], "toolUse");
          stream.push({ type: "start", partial: message });
          stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
          const call = message.content[0];
          if (call?.type !== "toolCall") throw new Error("negative fixture did not create a tool call");
          stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: message });
          stream.push({ type: "done", reason: "toolUse", message });
        } else {
          const message = assistant([{ type: "text", text: "这是普通草稿" }], "stop");
          stream.push({ type: "start", partial: message });
          stream.push({ type: "text_start", contentIndex: 0, partial: message });
          stream.push({ type: "text_delta", contentIndex: 0, delta: "这是普通草稿", partial: message });
          stream.push({ type: "text_end", contentIndex: 0, content: "这是普通草稿", partial: message });
          stream.push({ type: "done", reason: "stop", message });
        }
        stream.end();
      });
      return stream;
    };

    await expect(new P1Host().runTurn({
      dataDir: root,
      dilemmaId: "d-negative",
      personaId: "wang-yangming",
      operationId: "op-negative",
      messageId: "msg-negative",
      text: "请回答这个问题。",
      model,
      streamFn,
    })).rejects.toThrow("accepted persona_turn_submit");

    const events = await new JsonlProductRepository(root).readEvents();
    expect(events.some((event) => event.type === "accepted-turn")).toBe(false);
    expect(events.filter((event) => event.type === "user-message")).toHaveLength(1);
  });
});
