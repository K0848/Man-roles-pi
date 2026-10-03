import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { ProductTurnCoordinator } from "../../src/p4/product-turn-coordinator.js";

const model = {
  id: "p4-coordinator-fake", name: "p4-coordinator-fake", api: "fake-api", provider: "fake", baseUrl: "http://p4.invalid",
  reasoning: false, input: ["text"] as ("text" | "image")[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 128,
};
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

describe("P4 product outcome linearization", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it("publishes cancelled once when cancel wins", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p4-coordinator-"));
    roots.push(root);
    const streamFn = (_model: typeof model, _context: unknown, options?: { signal?: AbortSignal }) => {
      const stream = createAssistantMessageEventStream();
      options?.signal?.addEventListener("abort", () => { stream.push({ type: "error", reason: "aborted", error: { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "aborted", errorMessage: "cancelled", timestamp: Date.now() } }); stream.end(); }, { once: true });
      return stream;
    };
    const coordinator = new ProductTurnCoordinator(root);
    const start = coordinator.start({ dataDir: root, dilemmaId: "d1", personaId: "wang-yangming", messageId: "m1", operationId: "op-cancel", run: { model, streamFn, prompt: "long" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await coordinator.cancel({ operationId: "op-cancel", dilemmaId: "d1", personaId: "wang-yangming", messageId: "m1" });
    await start;
    await coordinator.cancel({ operationId: "op-cancel", dilemmaId: "d1", personaId: "wang-yangming", messageId: "m1" });
    const terminal = await coordinator.terminal("op-cancel");
    expect(terminal?.type).toBe("cancelled-turn");
  });

  it("keeps accepted as the winner when completion happens before a late cancel", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p4-accepted-"));
    roots.push(root);
    const streamFn = (_model: typeof model, _context: unknown) => {
      const stream = createAssistantMessageEventStream();
      const response = { role: "assistant" as const, content: [{ type: "text" as const, text: "done" }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop" as const, timestamp: Date.now() };
      queueMicrotask(() => { stream.push({ type: "start", partial: response }); stream.push({ type: "done", reason: "stop", message: response }); stream.end(); });
      return stream;
    };
    const coordinator = new ProductTurnCoordinator(root);
    await coordinator.start({ dataDir: root, dilemmaId: "d1", personaId: "wang-yangming", messageId: "m2", operationId: "op-accepted", run: { model, streamFn, prompt: "short" } });
    const lateCancel = await coordinator.cancel({ operationId: "op-accepted", dilemmaId: "d1", personaId: "wang-yangming", messageId: "m2" });
    expect(lateCancel?.type).toBe("accepted-turn");
    expect((await coordinator.terminal("op-accepted"))?.type).toBe("accepted-turn");
  });
});
