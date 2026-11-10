import { useContext, useEffect, useRef, useState, createContext, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL_OPTIONS,
  REASONING_OPTIONS,
  clearModelSettings,
  listenModelSettings,
  loadModelSettings,
  maskKey,
  modelSettingsSummary,
  saveModelSettings,
  type DeepSeekModel,
  type ReasoningEffort,
} from "./modelSettings";
import "./model-settings.css";

export const ModelSettingsContext = createContext<() => void>(() => {});
export const useOpenModelSettings = () => useContext(ModelSettingsContext);

const PROVIDER_HOST = new URL(DEEPSEEK_BASE_URL).host;

export function ModelSettingsButton({ onClick }: { onClick: () => void }) {
  const [summary, setSummary] = useState(modelSettingsSummary);
  useEffect(() => listenModelSettings(() => setSummary(modelSettingsSummary())), []);
  const model = summary?.model;
  const status = model ?? "未配置";
  return <button type="button" className={`model-settings-entry${model ? " is-ready" : ""}`} onClick={onClick} aria-label={model ? `模型设置，当前模型 ${model}` : "模型设置，尚未配置密钥"}>
    <KeyRound size={15} aria-hidden="true"/>
    <span className="model-settings-label">模型设置</span>
    <span className="model-settings-status"><i className="model-settings-dot" aria-hidden="true"/><span>{status}</span></span>
  </button>;
}

const keyShape = /^[\x21-\x7e]+$/;

export default function ModelSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [model, setModel] = useState<DeepSeekModel>("deepseek-flash");
  const [reasoning, setReasoning] = useState<ReasoningEffort>("high");
  const [sessionOnly, setSessionOnly] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [savedPersistence, setSavedPersistence] = useState<"local" | "session" | null>(null);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      const saved = loadModelSettings();
      setModel(saved?.model ?? "deepseek-flash");
      setReasoning(saved?.reasoning ?? "high");
      setSessionOnly(saved?.persistence === "session");
      setSavedKey(saved?.apiKey ?? "");
      setSavedPersistence(saved?.persistence ?? null);
      setKeyInput("");
      setReveal(false);
      setError(null);
      node.showModal();
    } else if (!open && node.open) node.close();
  }, [open]);

  function save(event: FormEvent) {
    event.preventDefault();
    const apiKey = (keyInput.trim() || savedKey).trim();
    if (!apiKey || apiKey.length > 256 || !keyShape.test(apiKey)) {
      setError("请填写有效的 DeepSeek API Key。");
      return;
    }
    try {
      saveModelSettings({ model, apiKey, reasoning, persistence: sessionOnly ? "session" : "local" });
    } catch {
      setError("浏览器无法保存密钥，请检查是否禁止了本地存储。");
      return;
    }
    onClose();
  }

  function clear() {
    clearModelSettings();
    setSavedKey("");
    setSavedPersistence(null);
    setKeyInput("");
    setError(null);
  }

  return <dialog ref={dialog} className="modal model-settings-dialog" onClose={onClose} aria-labelledby="model-settings-title">
    <form onSubmit={save}>
      <div className="modal-heading">
        <h2 id="model-settings-title">模型设置</h2>
        <button type="button" className="icon-button" aria-label="关闭模型设置" onClick={onClose}><X size={18}/></button>
      </div>
      <p className="modal-description">四个助手都使用你自己的 DeepSeek 密钥。密钥只留在这台浏览器里。</p>
      <p className="ms-provider">DeepSeek 官方 · {PROVIDER_HOST}</p>
      <div className="ms-pair">
        <label>模型
          <select value={model} onChange={event => setModel(event.target.value as DeepSeekModel)}>
            {DEEPSEEK_MODEL_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>思考强度
          <select value={reasoning} onChange={event => setReasoning(event.target.value as ReasoningEffort)}>
            {REASONING_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <label>API Key
        {savedKey && <span className="model-settings-mask">当前密钥 {maskKey(savedKey)} · {savedPersistence === "session" ? "仅当前标签页" : "本浏览器"}</span>}
        <span className="model-settings-keyline">
          <input type={reveal ? "text" : "password"} value={keyInput} autoComplete="off" spellCheck={false} placeholder={savedKey ? "留空则继续使用当前密钥" : "粘贴 DeepSeek API Key"} onChange={event => setKeyInput(event.target.value)}/>
          <button type="button" className="model-settings-reveal" aria-label={reveal ? "隐藏密钥" : "显示密钥"} aria-pressed={reveal} onClick={() => setReveal(value => !value)}>{reveal ? <EyeOff size={16} aria-hidden="true"/> : <Eye size={16} aria-hidden="true"/>}</button>
        </span>
      </label>
      <div className="model-settings-keep">
        <label className="model-settings-check" htmlFor="model-settings-session"><input id="model-settings-session" type="checkbox" checked={sessionOnly} aria-describedby="model-settings-session-hint" onChange={event => setSessionOnly(event.target.checked)}/>不在此设备保存</label>
        <p id="model-settings-session-hint">勾选后只留在当前标签页，关闭即清除。</p>
      </div>
      {error && <p className="model-settings-error" role="alert">{error}</p>}
      <div className="modal-footer">
        <button type="button" className="text-button" onClick={clear} disabled={!savedKey && !keyInput}>清除密钥</button>
        <div className="ms-actions">
          <button type="button" className="outline-button ms-cancel" onClick={onClose}>取消</button>
          <button type="submit" className="primary-button">保存</button>
        </div>
      </div>
    </form>
  </dialog>;
}
