import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { P1Host } from "../../src/p1/host.js";
import { JsonlProductRepository } from "../../src/p1/product-repository.js";
import { JsonlSessionLog } from "../../src/p1/session-log.js";
import { P6Server, type RemoteApplication, type RemoteTurnRequest } from "../../src/p6/server.js";
import { createPiModelRuntime, createProxyAwareFetch, getConfiguredModel } from "../../src/p7/provider-registry.js";

if (process.env.PI_RUN_REAL !== "1") {
  console.log(JSON.stringify({ status: "skipped", reason: "set PI_RUN_REAL=1 to allow a real Product Host call" }));
  process.exit(0);
}

const provider = process.env.PI_PROVIDER ?? "openai-codex";
const modelId = process.env.PI_MODEL ?? "gpt-5.5";
const runtime = await createPiModelRuntime();
const auth = await runtime.checkAuth(provider);
if (!auth) {
  console.log(JSON.stringify({ status: "not_ready", provider, reason: "credential_not_configured" }));
  process.exit(2);
}
const model = getConfiguredModel(runtime, provider, modelId);
const providerEnv = Object.fromEntries(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"].flatMap((name) => {
  const value = process.env[name];
  return value === undefined ? [] : [[name, value]];
}));
const fetchImpl = createProxyAwareFetch(providerEnv);
const dataDir = await mkdtemp(join(tmpdir(), "man-roles-pi-p7-"));
const keepData = process.env.PI_KEEP_REAL_DATA === "1";
const products = new JsonlProductRepository(dataDir);
const host = new P1Host();
const app: RemoteApplication = {
  async getProjection(dilemmaId) {
    const events = (await products.readEvents()).filter((event) => event.dilemmaId === dilemmaId);
    return { dilemmaId, events, status: "ready" };
  },
  async submitTurn(input: RemoteTurnRequest) {
    return host.runTurn({
      ...input,
      dataDir,
      sessionId: `${input.dilemmaId}-${input.personaId}`,
      model,
      streamFn: (requestModel, context, options) => runtime.stream(requestModel, context, {
        ...options,
        env: providerEnv,
        fetch: fetchImpl,
        transport: "sse",
      }),
    });
  },
};

const server = new P6Server(app);
const started = Date.now();
const port = await server.listen();
try {
  const page = await fetch(`http://127.0.0.1:${port}/`);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  const operationId = `p7-real-${Date.now()}`;
  const turn = await fetch(`http://127.0.0.1:${port}/api/conversations/p7-demo/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dilemmaId: "p7-demo",
      personaId: "wang-yangming",
      operationId,
      messageId: `${operationId}-message`,
      text: "我最近在工作选择上反复犹豫，请先查一条允许的资料，再给出一个简短、可执行的建议。",
    }),
  });
  const body = await turn.json() as { status?: string; reused?: boolean; evidenceIds?: string[]; text?: string; error?: string };
  const events = await products.readEvents();
  const sessionEvents = await new JsonlSessionLog(dataDir, "p7-demo-wang-yangming").read();
  const sessionEventTypeCounts = Object.fromEntries([...new Set(sessionEvents.map((event) => event.type))].map((type) => [type, sessionEvents.filter((event) => event.type === type).length]));
  const toolResultNames = sessionEvents.filter((event) => event.type === "message_end" && (event.payload as { role?: string } | undefined)?.role === "toolResult").map((event) => (event.payload as { toolName?: string }).toolName ?? "unknown");
  console.log(JSON.stringify({
    status: body.status === "accepted" ? "completed" : "failed",
    provider,
    model: model.id,
    pageStatus: page.status,
    healthStatus: health.status,
    turnStatus: turn.status,
    accepted: body.status === "accepted",
    reused: body.reused ?? false,
    evidenceCount: body.evidenceIds?.length ?? 0,
    responseTextLength: body.text?.length ?? 0,
    error: body.error?.slice(0, 240),
    productEventTypes: events.map((event) => event.type),
    sessionEventTypeCounts,
    toolResultNames,
    elapsedMs: Date.now() - started,
    ...(keepData ? { dataDir } : {}),
  }));
  process.exitCode = body.status === "accepted" ? 0 : 1;
} finally {
  await server.close();
  if (!keepData) await rm(dataDir, { recursive: true, force: true });
}
