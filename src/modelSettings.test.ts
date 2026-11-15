import test from "node:test";
import assert from "node:assert/strict";
import {
  DEEPSEEK_BASE_URL,
  clearModelSettings,
  isValidOpenModelId,
  loadModelSettings,
  maskKey,
  modelHeaders,
  modelSettingsSummary,
  normalizeLocalBaseUrl,
  saveModelSettings,
} from "./modelSettings";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

function install() {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });
  return { local, session };
}

test("mask shows only the last four characters or no-key label", () => {
  assert.equal(maskKey("sk-byok-TESTKEY-zz99"), "••••zz99");
  assert.equal(maskKey("abcd"), "••••");
  assert.equal(maskKey(""), "免密钥");
  assert.equal(JSON.stringify({ mask: maskKey("sk-byok-TESTKEY-zz99") }).includes("TESTKEY"), false);
});

test("key stays in the chosen browser store and leaves the request body", () => {
  const { local, session } = install();
  saveModelSettings({ model: "deepseek-v4-pro", apiKey: "sk-byok-TESTKEY-zz99", reasoning: "low", persistence: "local" });
  assert.equal(session.getItem("optics-model-settings-session-v1"), null);
  assert.match(local.getItem("optics-model-settings-v1") ?? "", /sk-byok-TESTKEY-zz99/);
  const headers = modelHeaders();
  const body = JSON.stringify({ requestId: "turn", message: "解释焦距" });
  assert.equal(headers["X-AI-Key"], "sk-byok-TESTKEY-zz99");
  assert.equal(headers["X-AI-Base-URL"], DEEPSEEK_BASE_URL);
  assert.equal(headers["X-AI-Model"], "deepseek-v4-pro");
  assert.equal(body.includes("sk-byok-TESTKEY-zz99"), false);
  assert.equal(body.includes("X-AI-Key"), false);
  const summary = modelSettingsSummary();
  assert.equal(summary?.mask, "••••zz99");
  assert.equal(summary?.provider, "deepseek");
  assert.equal(JSON.stringify(summary).includes("sk-byok-TESTKEY-zz99"), false);

  saveModelSettings({ model: "deepseek-flash", apiKey: "sk-session-only-key1", reasoning: "high", persistence: "session" });
  assert.equal(local.getItem("optics-model-settings-v1"), null);
  assert.equal(loadModelSettings()?.persistence, "session");
  assert.equal(loadModelSettings()?.apiKey, "sk-session-only-key1");

  clearModelSettings();
  assert.equal(loadModelSettings(), null);
  assert.deepEqual(modelHeaders(), {});
});

test("legacy v1 DeepSeek records load transparently", () => {
  const { local } = install();
  local.setItem("optics-model-settings-v1", JSON.stringify({
    version: 1,
    model: "deepseek-v4-pro",
    apiKey: "sk-legacy-1234",
    reasoning: "high",
  }));
  const loaded = loadModelSettings();
  assert.equal(loaded?.provider, "deepseek");
  assert.equal(loaded?.baseUrl, DEEPSEEK_BASE_URL);
  assert.equal(loaded?.model, "deepseek-v4-pro");
  assert.equal(loaded?.apiKey, "sk-legacy-1234");
});

test("open cloud providers and keyless local runtimes persist and validate safely", () => {
  install();
  saveModelSettings({
    provider: "siliconflow",
    model: "Qwen/Qwen3-32B",
    apiKey: "sk-sf-open-9988",
    reasoning: "high",
    persistence: "local",
  });
  let headers = modelHeaders();
  assert.equal(headers["X-AI-Base-URL"], "https://api.siliconflow.cn/v1");
  assert.equal(headers["X-AI-Model"], "Qwen/Qwen3-32B");
  assert.equal(headers["X-AI-Key"], "sk-sf-open-9988");

  saveModelSettings({
    provider: "local",
    baseUrl: "http://127.0.0.1:11434/v1/",
    model: "qwen3:14b",
    apiKey: "",
    reasoning: "high",
    persistence: "local",
  });
  headers = modelHeaders();
  assert.equal(headers["X-AI-Base-URL"], "http://127.0.0.1:11434/v1");
  assert.equal(headers["X-AI-Model"], "qwen3:14b");
  assert.equal("X-AI-Key" in headers, false);
  assert.equal(modelSettingsSummary()?.mask, "免密钥");
  assert.equal(modelSettingsSummary()?.hasKey, false);

  assert.equal(normalizeLocalBaseUrl("http://localhost:1234/v1"), "http://localhost:1234/v1");
  assert.equal(normalizeLocalBaseUrl("http://192.168.1.5:11434/v1"), null);
  assert.equal(normalizeLocalBaseUrl("http://127.0.0.1:11434/admin"), null);
  assert.equal(normalizeLocalBaseUrl("http://user:pass@127.0.0.1:11434/v1"), null);
  assert.equal(isValidOpenModelId("Qwen/Qwen2.5-72B-Instruct"), true);
  assert.equal(isValidOpenModelId("qwen3:14b"), true);
  assert.equal(isValidOpenModelId("bad model name"), false);
});
