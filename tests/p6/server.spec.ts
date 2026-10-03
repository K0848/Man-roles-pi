import { describe, expect, it } from "vitest";
import { P6Server, type RemoteApplication } from "../../src/p6/server.js";

describe("P6 Product Remote/UI", () => {
  it("serves a product page, health endpoint, projection and turn endpoint", async () => {
    const app: RemoteApplication = {
      async getProjection(dilemmaId) { return { dilemmaId, events: [], status: "ready" }; },
      async submitTurn(input) { return { status: "accepted", operationId: input.operationId, personaId: input.personaId }; },
    };
    const server = new P6Server(app);
    const port = await server.listen();
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(await health.json()).toEqual({ ok: true, runtime: "pi" });
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(await page.text()).toContain("向古人问惑");
      const projection = await fetch(`http://127.0.0.1:${port}/api/conversations/demo/projection`);
      expect((await projection.json()).dilemmaId).toBe("demo");
      const turn = await fetch(`http://127.0.0.1:${port}/api/conversations/demo/turn`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dilemmaId: "demo", personaId: "wang-yangming", operationId: "ui-op", messageId: "ui-msg", text: "困惑" }),
      });
      expect((await turn.json()).status).toBe("accepted");
    } finally {
      await server.close();
    }
  });
});
