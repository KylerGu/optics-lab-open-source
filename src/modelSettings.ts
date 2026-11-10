/** Browser-only DeepSeek settings. The key never goes into a JSON request body. */

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

export interface StoredModelSettings {
  model: DeepSeekModel;
  apiKey: string;
  reasoning: ReasoningEffort;
  persistence: ModelPersistence;
}

const LOCAL_KEY = "optics-model-settings-v1";
const SESSION_KEY = "optics-model-settings-session-v1";

function storageOf(kind: ModelPersistence): Storage | null {
  try {
    const store = kind === "local" ? globalThis.localStorage : globalThis.sessionStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

function isModel(value: unknown): value is DeepSeekModel {
  return DEEPSEEK_MODEL_OPTIONS.some(option => option.id === value);
}

function isEffort(value: unknown): value is ReasoningEffort {
  return REASONING_OPTIONS.some(option => option.id === value);
}

function parseStored(raw: string | null, persistence: ModelPersistence): StoredModelSettings | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { model?: unknown; apiKey?: unknown; reasoning?: unknown };
    if (typeof value.apiKey !== "string" || !value.apiKey.trim()) return null;
    return {
      model: isModel(value.model) ? value.model : "deepseek-flash",
      apiKey: value.apiKey.trim(),
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

export function saveModelSettings(settings: StoredModelSettings): void {
  const payload = JSON.stringify({
    version: 1,
    model: settings.model,
    apiKey: settings.apiKey.trim(),
    reasoning: settings.reasoning,
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
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/** Safe to render. Does not include the key. */
export function modelSettingsSummary(): { model: DeepSeekModel; reasoning: ReasoningEffort; persistence: ModelPersistence; mask: string } | null {
  const settings = loadModelSettings();
  if (!settings) return null;
  return { model: settings.model, reasoning: settings.reasoning, persistence: settings.persistence, mask: maskKey(settings.apiKey) };
}

export function modelHeaders(): Record<string, string> {
  const settings = loadModelSettings();
  if (!settings) return {};
  return {
    "X-AI-Key": settings.apiKey,
    "X-AI-Base-URL": DEEPSEEK_BASE_URL,
    "X-AI-Model": settings.model,
    "X-AI-Reasoning": settings.reasoning,
  };
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
