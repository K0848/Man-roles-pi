import { createPiModelRuntime, listProviderIds } from "../../src/p7/provider-registry.js";

const runtime = await createPiModelRuntime();
const providerIds = ["openai-codex", "deepseek", "anthropic"].filter((id) => listProviderIds(runtime).includes(id));
const statuses = [];
for (const provider of providerIds) {
  const auth = await runtime.checkAuth(provider);
  let resolved: unknown;
  try {
    const value = await runtime.getAuth(provider);
    resolved = value ? { source: value.source, hasApiKey: typeof value.auth.apiKey === "string", hasHeaders: value.auth.headers !== undefined } : null;
  } catch (error) {
    resolved = { error: error instanceof Error ? error.message : String(error) };
  }
  statuses.push({ provider, configured: auth !== undefined, type: auth?.type ?? null, resolved, models: runtime.getModels(provider).map((model) => ({ id: model.id, api: model.api, baseUrl: model.baseUrl })) });
}
console.log(JSON.stringify({ statuses, credentials: await runtime.listCredentials() }));
