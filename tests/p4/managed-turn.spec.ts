import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { ManagedTurn } from "../../src/p4/managed-turn.js";
import { RequestBudget, RequestBudgetExceeded } from "../../src/p4/request-budget.js";
import { NoProgressTracker, RetryPolicy } from "../../src/p4/retry-policy.js";

const model = {
  id: "p4-managed-fake", name: "p4-managed-fake", api: "fake-api", provider: "fake", baseUrl: "http://p4.invalid",
  reasoning: false, input: ["text"] as ("text" | "image")[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 128,
};

describe("P4 managed control", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it("persists cancelling and cancelled terminal events exactly once", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p4-managed-"));
    roots.push(root);
    const streamFn = (_model: typeof model, _context: unknown, options?: { signal?: AbortSignal }) => {
      const stream = createAssistantMessageEventStream();
      const pending = { role: "assistant" as const, content: [{ type: "text" as const, text: "pending" }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" as const, timestamp: Date.now() };
      options?.signal?.addEventListener("abort", () => { stream.push({ type: "error", reason: "aborted", error: { ...pending, content: [], stopReason: "aborted", errorMessage: "cancelled" } }); stream.end(); }, { once: true });
      queueMicrotask(() => stream.push({ type: "start", partial: pending }));
      return stream;
    };
    const turn = new ManagedTurn(root);
    const run = turn.start("op-p4", { model, streamFn, prompt: "long" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await turn.cancel("op-p4");
    await run;
    await turn.cancel("op-p4");
    const events = await turn.readEvents();
    expect(events.map((event) => event.type)).toEqual(["execution-claimed", "execution-cancelling", "execution-cancelled"]);
  });

  it("stops a provider request sequence at the configured budget", () => {
    const budget = new RequestBudget(2);
    expect(budget.claim()).toBe(1);
    expect(budget.claim()).toBe(2);
    expect(() => budget.claim()).toThrow(RequestBudgetExceeded);
    expect(budget.used).toBe(2);
  });

  it("bounds transient retries and stops repeated no-progress fingerprints", () => {
    const retry = new RetryPolicy(2);
    expect(retry.decide("transient")).toBe("retry");
    expect(retry.decide("transient")).toBe("retry");
    expect(retry.decide("transient")).toBe("stop");
    expect(retry.decide("permission")).toBe("stop");

    const progress = new NoProgressTracker(2);
    expect(progress.observe("lookup|same-input|failed")).toBe("continue");
    expect(progress.observe("lookup|same-input|failed")).toBe("stop");
  });
});
