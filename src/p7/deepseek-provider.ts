import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

export function createDeepSeekModels() {
  const models = createModels();
  models.setProvider(deepseekProvider());
  return models;
}

export function getConfiguredDeepSeekModel(models: ReturnType<typeof createDeepSeekModels>) {
  const modelId = process.env.PI_DEEPSEEK_MODEL;
  if (!modelId) throw new Error("PI_DEEPSEEK_MODEL is required for the real Provider smoke");
  const model = models.getModel("deepseek", modelId);
  if (!model) throw new Error(`DeepSeek model '${modelId}' is not in the Pi catalog`);
  return model;
}
