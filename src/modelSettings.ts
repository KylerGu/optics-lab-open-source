/** Browser-only AI model settings. Credentials never go into a JSON request body. */

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const MODEL_SETTINGS_EVENT = "optics-model-settings-changed";

export const DEEPSEEK_MODEL_OPTIONS = [
  { id: "deepseek-flash", label: "deepseek-flash", hint: "更快，适合问答和调参" },
  { id: "deepseek-v4-pro", label: "deepseek-v4-pro", hint: "能力更强，费用更高" },
] as const;

export const REASONING_OPTIONS = [
  { id: "none", label: "关闭" },
  { id: "low", label: "低" },
  { id: "high", label: "高" },
  { id: "max", label: "最高" },
] as const;

export type DeepSeekModel = (typeof DEEPSEEK_MODEL_OPTIONS)[number]["id"];
export type ReasoningEffort = (typeof REASONING_OPTIONS)[number]["id"];
export type ModelPersistence = "local" | "session";
export type ModelProviderId = "deepseek" | "siliconflow" | "dashscope" | "openrouter" | "local";

export interface ModelPresetOption {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
}

export interface ModelProviderOption {
  readonly id: ModelProviderId;
  readonly label: string;
  readonly shortLabel: string;
  readonly baseUrl: string;
  readonly websiteUrl: string;
  readonly requiresKey: boolean;
  readonly supportsReasoning: boolean;
  readonly editableBaseUrl: boolean;
  readonly customModelAllowed: boolean;
  readonly keyPlaceholder: string;
  readonly note: string;
  readonly models: readonly ModelPresetOption[];
}

export const MODEL_PROVIDERS: readonly ModelProviderOption[] = [
  {
    id: "deepseek",
    label: "DeepSeek 官方",
    shortLabel: "DeepSeek",
    baseUrl: DEEPSEEK_BASE_URL,
    websiteUrl: "https://platform.deepseek.com",
    requiresKey: true,
    supportsReasoning: true,
    editableBaseUrl: false,
    customModelAllowed: false,
    keyPlaceholder: "粘贴 DeepSeek API Key",
    note: "默认推荐：中文光学推导与多工具搭建稳定，可调节思考强度。",
    models: DEEPSEEK_MODEL_OPTIONS,
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow（开源模型）",
    shortLabel: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    websiteUrl: "https://cloud.siliconflow.cn",
    requiresKey: true,
    supportsReasoning: false,
    editableBaseUrl: false,
    customModelAllowed: true,
    keyPlaceholder: "粘贴硅基流动 API Key",
    note: "聚合主流开源权重；复杂光路搭建建议使用 32B 及以上支持工具调用的模型。",
    models: [
      { id: "Qwen/Qwen3-32B", label: "Qwen/Qwen3-32B", hint: "轻量主力，兼顾速度与工具调用" },
      { id: "Qwen/Qwen2.5-72B-Instruct", label: "Qwen/Qwen2.5-72B-Instruct", hint: "理工推导与多步探究稳" },
      { id: "deepseek-ai/DeepSeek-V3", label: "deepseek-ai/DeepSeek-V3", hint: "开源旗舰，搭建成功率高" },
      { id: "THUDM/GLM-4-32B-0414", label: "THUDM/GLM-4-32B-0414", hint: "轻量问答均衡" },
    ],
  },
  {
    id: "dashscope",
    label: "阿里云百炼（通义千问开源版）",
    shortLabel: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    websiteUrl: "https://bailian.aliyun.com",
    requiresKey: true,
    supportsReasoning: false,
    editableBaseUrl: false,
    customModelAllowed: true,
    keyPlaceholder: "粘贴阿里云百炼 API Key",
    note: "通义千问 OpenAI 兼容接口；支持预设或手填百炼模型名称。",
    models: [
      { id: "qwen3-32b", label: "qwen3-32b", hint: "主力推荐，公式与工具调用稳定" },
      { id: "qwen2.5-72b-instruct", label: "qwen2.5-72b-instruct", hint: "大参数开源版，复杂实验更稳" },
      { id: "qwen-plus", label: "qwen-plus", hint: "响应快，适合日常场景助教" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter（开源模型聚合）",
    shortLabel: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    websiteUrl: "https://openrouter.ai",
    requiresKey: true,
    supportsReasoning: false,
    editableBaseUrl: false,
    customModelAllowed: true,
    keyPlaceholder: "粘贴 OpenRouter API Key",
    note: "统一接入多款开源大模型，支持手填自定义模型 ID。",
    models: [
      { id: "qwen/qwen3-32b", label: "qwen/qwen3-32b", hint: "开源推荐" },
      { id: "deepseek/deepseek-chat-v3-0324", label: "deepseek/deepseek-chat-v3-0324", hint: "工具调用与光学解释强" },
      { id: "meta-llama/llama-3.3-70b-instruct", label: "meta-llama/llama-3.3-70b-instruct", hint: "70B 开源通用模型" },
    ],
  },
  {
    id: "local",
    label: "本地开源模型（Ollama / vLLM / LM Studio）",
    shortLabel: "本地服务",
    baseUrl: "http://127.0.0.1:11434/v1",
    websiteUrl: "https://ollama.com",
    requiresKey: false,
    supportsReasoning: false,
    editableBaseUrl: true,
    customModelAllowed: true,
    keyPlaceholder: "本地服务通常留空（开启鉴权时再填写）",
    note: "仅本地运行后端时可用；光路搭建与探究建议 14B 及以上支持工具调用的模型。",
    models: [
      { id: "qwen3:14b", label: "qwen3:14b", hint: "本地推荐起点（14B）" },
      { id: "qwen3:32b", label: "qwen3:32b", hint: "高准确度，适合复杂探究" },
      { id: "qwen2.5:14b", label: "qwen2.5:14b", hint: "稳定调用实验工具" },
      { id: "deepseek-r1:14b", label: "deepseek-r1:14b", hint: "适合概念推导（视版本支持工具调用）" },
    ],
  },
];

export interface StoredModelSettings {
  provider: ModelProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoning: ReasoningEffort;
  persistence: ModelPersistence;
}

export interface SaveModelSettingsInput {
  provider?: ModelProviderId;
  baseUrl?: string;
  model: string;
  apiKey: string;
  reasoning: ReasoningEffort;
  persistence: ModelPersistence;
}

const LOCAL_KEY = "optics-model-settings-v1";
const SESSION_KEY = "optics-model-settings-session-v1";
const OPEN_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function storageOf(kind: ModelPersistence): Storage | null {
  try {
    const store = kind === "local" ? globalThis.localStorage : globalThis.sessionStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

export function getModelProvider(id: unknown): ModelProviderOption {
  return MODEL_PROVIDERS.find(item => item.id === id) ?? MODEL_PROVIDERS[0];
}

function isDeepSeekModel(value: unknown): value is DeepSeekModel {
  return DEEPSEEK_MODEL_OPTIONS.some(option => option.id === value);
}

function isEffort(value: unknown): value is ReasoningEffort {
  return REASONING_OPTIONS.some(option => option.id === value);
}

export function isValidOpenModelId(value: string): boolean {
  return OPEN_MODEL_RE.test(value.trim());
}

export function normalizeLocalBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase())) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const path = parsed.pathname.replace(/\/+$/, "");
    if (path !== "" && path !== "/v1") return null;
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return null;
  }
}

function normalizeProviderSettings(input: SaveModelSettingsInput): {
  provider: ModelProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoning: ReasoningEffort;
} {
  const provider = getModelProvider(input.provider);
  const apiKey = input.apiKey.trim();
  const baseUrl = provider.editableBaseUrl
    ? normalizeLocalBaseUrl(input.baseUrl ?? provider.baseUrl) ?? provider.baseUrl
    : provider.baseUrl;
  const rawModel = input.model.trim();
  const model = provider.id === "deepseek"
    ? (isDeepSeekModel(rawModel) ? rawModel : "deepseek-flash")
    : (isValidOpenModelId(rawModel) ? rawModel : provider.models[0].id);
  const reasoning = isEffort(input.reasoning) ? input.reasoning : "high";
  return { provider: provider.id, baseUrl, model, apiKey, reasoning };
}

function parseStored(raw: string | null, persistence: ModelPersistence): StoredModelSettings | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as {
      provider?: unknown;
      baseUrl?: unknown;
      model?: unknown;
      apiKey?: unknown;
      reasoning?: unknown;
    };
    const provider = getModelProvider(value.provider);
    const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : "";
    if (provider.requiresKey && !apiKey) return null;
    const rawBase = typeof value.baseUrl === "string" ? value.baseUrl : provider.baseUrl;
    const baseUrl = provider.editableBaseUrl ? normalizeLocalBaseUrl(rawBase) : provider.baseUrl;
    if (!baseUrl) return null;
    const rawModel = typeof value.model === "string" ? value.model.trim() : "";
    const model = provider.id === "deepseek"
      ? (isDeepSeekModel(rawModel) ? rawModel : "deepseek-flash")
      : (isValidOpenModelId(rawModel) ? rawModel : "");
    if (!model) return null;
    return {
      provider: provider.id,
      baseUrl,
      model,
      apiKey,
      reasoning: isEffort(value.reasoning) ? value.reasoning : "high",
      persistence,
    };
  } catch {
    return null;
  }
}

export function loadModelSettings(): StoredModelSettings | null {
  return parseStored(storageOf("session")?.getItem(SESSION_KEY) ?? null, "session")
    ?? parseStored(storageOf("local")?.getItem(LOCAL_KEY) ?? null, "local");
}

export function saveModelSettings(settings: SaveModelSettingsInput): void {
  const normalized = normalizeProviderSettings(settings);
  const payload = JSON.stringify({
    version: 2,
    provider: normalized.provider,
    baseUrl: normalized.baseUrl,
    model: normalized.model,
    apiKey: normalized.apiKey,
    reasoning: normalized.reasoning,
  });
  const local = storageOf("local");
  const session = storageOf("session");
  if (settings.persistence === "session") {
    session?.setItem(SESSION_KEY, payload);
    local?.removeItem(LOCAL_KEY);
  } else {
    local?.setItem(LOCAL_KEY, payload);
    session?.removeItem(SESSION_KEY);
  }
  notifyModelSettings();
}

export function clearModelSettings(): void {
  storageOf("local")?.removeItem(LOCAL_KEY);
  storageOf("session")?.removeItem(SESSION_KEY);
  notifyModelSettings();
}

export function maskKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return "免密钥";
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/** Safe to render. Does not include the key. */
export function modelSettingsSummary(): {
  provider: ModelProviderId;
  providerLabel: string;
  baseUrl: string;
  model: string;
  reasoning: ReasoningEffort;
  persistence: ModelPersistence;
  mask: string;
  hasKey: boolean;
} | null {
  const settings = loadModelSettings();
  if (!settings) return null;
  const provider = getModelProvider(settings.provider);
  return {
    provider: settings.provider,
    providerLabel: provider.shortLabel,
    baseUrl: settings.baseUrl,
    model: settings.model,
    reasoning: settings.reasoning,
    persistence: settings.persistence,
    mask: maskKey(settings.apiKey),
    hasKey: Boolean(settings.apiKey),
  };
}

export function modelHeaders(): Record<string, string> {
  const settings = loadModelSettings();
  if (!settings) return {};
  const headers: Record<string, string> = {
    "X-AI-Base-URL": settings.baseUrl,
    "X-AI-Model": settings.model,
    "X-AI-Reasoning": settings.reasoning,
  };
  if (settings.apiKey) {
    headers["X-AI-Key"] = settings.apiKey;
  }
  return headers;
}

export function notifyModelSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
}

export function listenModelSettings(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MODEL_SETTINGS_EVENT, onChange);
  return () => window.removeEventListener(MODEL_SETTINGS_EVENT, onChange);
}
