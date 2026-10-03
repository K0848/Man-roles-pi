import { describe, expect, it } from "vitest";
import { createDeepSeekModels } from "../../src/p7/deepseek-provider.js";
import { createBuiltinProviderModels, createPiModelRuntime, listProviderIds } from "../../src/p7/provider-registry.js";

describe("P7 real Provider entry", () => {
  it("constructs the official DeepSeek provider without loading a key", () => {
    const models = createDeepSeekModels();
    expect(models.getProvider("deepseek")?.id).toBe("deepseek");
    expect(models.getModels("deepseek").length).toBeGreaterThan(0);
  });

  it("exposes the Pi built-in provider catalog, including OpenAI Codex", () => {
    const providers = listProviderIds(createBuiltinProviderModels());
    expect(providers).toContain("deepseek");
    expect(providers).toContain("openai-codex");
    expect(providers).toContain("anthropic");
  });

  it("can inspect Pi ModelRuntime provider/auth state without network refresh", async () => {
    const runtime = await createPiModelRuntime();
    expect(runtime.getProvider("openai-codex")?.id).toBe("openai-codex");
    const auth = await runtime.checkAuth("openai-codex");
    expect(auth === undefined || typeof auth.type === "string").toBe(true);
  });
});
