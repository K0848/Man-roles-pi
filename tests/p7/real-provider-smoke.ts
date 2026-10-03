import { createPiModelRuntime, createProxyAwareFetch, getConfiguredModel } from "../../src/p7/provider-registry.js";

if (process.env.PI_RUN_REAL !== "1") {
  console.log(JSON.stringify({ status: "skipped", reason: "set PI_RUN_REAL=1 to allow a real Provider call" }));
  process.exit(0);
}
const provider = process.env.PI_PROVIDER ?? "deepseek";
const modelId = process.env.PI_MODEL ?? process.env.PI_DEEPSEEK_MODEL;
if (!modelId) throw new Error("PI_MODEL (or PI_DEEPSEEK_MODEL) is required for the real Provider smoke");
if (provider === "deepseek" && !process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is required for the DeepSeek smoke");
const runtime = await createPiModelRuntime();
const auth = await runtime.checkAuth(provider);
if (!auth) {
  console.log(JSON.stringify({ status: "not_ready", provider, reason: "credential_not_configured" }));
  process.exit(2);
}
const model = getConfiguredModel(runtime, provider, modelId);
const started = Date.now();
const env = Object.fromEntries(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"].flatMap((name) => {
  const value = process.env[name];
  return value === undefined ? [] : [[name, value]];
}));
const response = await runtime.completeSimple(model, { systemPrompt: "Answer briefly.", messages: [{ role: "user", content: "请只回复：Pi smoke ok", timestamp: Date.now() }] }, {
  env,
  // Node's global fetch does not honor HTTP_PROXY; use deterministic SSE plus
  // an injected dispatcher-aware fetch for the desktop proxy path.
  transport: "sse",
  fetch: createProxyAwareFetch(env),
});
console.log(JSON.stringify({ status: response.stopReason === "error" ? "failed" : "completed", provider, model: model.id, stopReason: response.stopReason, errorMessage: response.errorMessage, elapsedMs: Date.now() - started, usage: response.usage, textLength: response.content.reduce((total, block) => total + (block.type === "text" ? block.text.length : 0), 0) }));
