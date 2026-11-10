import test from "node:test";
import assert from "node:assert/strict";
import { DEEPSEEK_BASE_URL, clearModelSettings, loadModelSettings, maskKey, modelHeaders, modelSettingsSummary, saveModelSettings } from "./modelSettings";

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

test("mask shows only the last four characters", () => {
  assert.equal(maskKey("sk-byok-TESTKEY-zz99"), "••••zz99");
  assert.equal(maskKey("abcd"), "••••");
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
  assert.equal(JSON.stringify(summary).includes("sk-byok-TESTKEY-zz99"), false);

  saveModelSettings({ model: "deepseek-flash", apiKey: "sk-session-only-key1", reasoning: "high", persistence: "session" });
  assert.equal(local.getItem("optics-model-settings-v1"), null);
  assert.equal(loadModelSettings()?.persistence, "session");
  assert.equal(loadModelSettings()?.apiKey, "sk-session-only-key1");

  clearModelSettings();
  assert.equal(loadModelSettings(), null);
  assert.deepEqual(modelHeaders(), {});
});
