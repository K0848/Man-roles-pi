import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { resolveHttpProxyUrlForTarget } from "@earendil-works/pi-ai/utils/node-http-proxy";
import type { FetchFunction, Models, ProviderEnv } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fetch as undiciFetch, ProxyAgent } from "undici";

/** Builds the full Pi built-in provider catalog; auth is resolved only when a request runs. */
export function createBuiltinProviderModels() {
  return builtinModels();
}

export function listProviderIds(models: Pick<Models, "getProviders">): string[] {
  return models.getProviders().map((provider) => provider.id).sort();
}

export function getConfiguredModel(models: Pick<Models, "getModel">, providerId: string, modelId: string) {
  const model = models.getModel(providerId, modelId);
  if (!model) throw new Error(`Model '${modelId}' is not in provider '${providerId}' catalog`);
  return model;
}

/** Loads Pi's own auth.json through the official ModelRuntime without network refresh. */
export function createPiModelRuntime(): Promise<ModelRuntime> {
  return ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
}

/**
 * Creates a Node fetch implementation that honors Pi's provider-scoped proxy
 * environment. Node's built-in global fetch does not consume HTTP_PROXY, so
 * passing `env` alone is insufficient for a desktop/runtime process behind a
 * local HTTP proxy. Pi's OpenAI Codex adapter accepts this fetch override.
 */
export function createProxyAwareFetch(env: ProviderEnv = Object.fromEntries(
  ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"].flatMap((key) => {
    const value = process.env[key];
    return value === undefined ? [] : [[key, value]];
  }),
)): FetchFunction {
  const dispatchers = new Map<string, ProxyAgent>();
  return ((input: Parameters<FetchFunction>[0], init?: Parameters<FetchFunction>[1]) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const proxyUrl = resolveHttpProxyUrlForTarget(target, env);
    if (!proxyUrl) return globalThis.fetch(input, init);
    let dispatcher = dispatchers.get(proxyUrl.toString());
    if (!dispatcher) {
      dispatcher = new ProxyAgent(proxyUrl.toString());
      dispatchers.set(proxyUrl.toString(), dispatcher);
    }
    return undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    }) as ReturnType<FetchFunction>;
  }) as FetchFunction;
}
