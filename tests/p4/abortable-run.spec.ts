import { describe, expect, it } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AbortablePiRun } from "../../src/p4/abortable-run.js";

const model = {
  id: "p4-fake", name: "p4-fake", api: "fake-api", provider: "fake", baseUrl: "http://p4.invalid",
  reasoning: false, input: ["text"] as ("text" | "image")[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 128,
};
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

describe("P4 Pi abort seam", () => {
  it("propagates cancel to a running Agent and reaches cancelled", async () => {
    let signalSeen = false;
    const streamFn = (_model: typeof model, _context: unknown, options?: { signal?: AbortSignal }) => {
      const stream = createAssistantMessageEventStream();
      signalSeen = options?.signal !== undefined;
      const message: AssistantMessage = {
        role: "assistant", content: [{ type: "text", text: "pending" }], api: model.api, provider: model.provider, model: model.id,
        usage, stopReason: "stop", timestamp: Date.now(),
      };
      options?.signal?.addEventListener("abort", () => {
        const aborted: AssistantMessage = { ...message, content: [], stopReason: "aborted", errorMessage: "cancelled" };
        stream.push({ type: "error", reason: "aborted", error: aborted });
        stream.end();
      }, { once: true });
      queueMicrotask(() => stream.push({ type: "start", partial: message }));
      return stream;
    };
    const run = new AbortablePiRun();
    const pending = run.start({ model, streamFn, prompt: "long task" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await run.cancel();
    await pending;
    expect(signalSeen).toBe(true);
    expect(run.state).toBe("cancelled");
  });
});
