import { useContext, useEffect, useRef, useState, createContext, type FormEvent } from "react";
import { ArrowUpRight, Eye, EyeOff, KeyRound, X } from "lucide-react";
import {
  MODEL_PROVIDERS,
  REASONING_OPTIONS,
  clearModelSettings,
  getModelProvider,
  isValidOpenModelId,
  listenModelSettings,
  loadModelSettings,
  maskKey,
  modelSettingsSummary,
  normalizeLocalBaseUrl,
  saveModelSettings,
  type ModelProviderId,
  type ReasoningEffort,
} from "./modelSettings";
import "./model-settings.css";

export const ModelSettingsContext = createContext<() => void>(() => {});
export const useOpenModelSettings = () => useContext(ModelSettingsContext);

const CUSTOM_MODEL = "__custom__";

export function ModelSettingsButton({ onClick }: { onClick: () => void }) {
  const [summary, setSummary] = useState(modelSettingsSummary);
  useEffect(() => listenModelSettings(() => setSummary(modelSettingsSummary())), []);
  const model = summary?.model;
  const status = model ?? "未配置";
  const label = summary
    ? `模型设置，当前 ${summary.providerLabel} · ${summary.model}`
    : "模型设置，尚未配置模型接口";
  return <button type="button" className={`model-settings-entry${model ? " is-ready" : ""}`} onClick={onClick} aria-label={label} title={summary ? `${summary.providerLabel} · ${summary.model}` : undefined}>
    <KeyRound size={14} aria-hidden="true"/>
    <span className="model-settings-label">模型设置</span>
    <span className="model-settings-status"><i className="model-settings-dot" aria-hidden="true"/><span>{status}</span></span>
  </button>;
}

const keyShape = /^[\x21-\x7e]+$/;

function displayHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export default function ModelSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [providerId, setProviderId] = useState<ModelProviderId>("deepseek");
  const [baseUrlInput, setBaseUrlInput] = useState(MODEL_PROVIDERS[0].baseUrl);
  const [model, setModel] = useState<string>("deepseek-flash");
  const [customMode, setCustomMode] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const [reasoning, setReasoning] = useState<ReasoningEffort>("high");
  const [sessionOnly, setSessionOnly] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [hasSaved, setHasSaved] = useState(false);
  const [savedPersistence, setSavedPersistence] = useState<"local" | "session" | null>(null);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = getModelProvider(providerId);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      const saved = loadModelSettings();
      const activeProvider = getModelProvider(saved?.provider ?? "deepseek");
      const activeModel = saved?.model ?? activeProvider.models[0].id;
      const isPreset = activeProvider.models.some(item => item.id === activeModel);
      setProviderId(activeProvider.id);
      setBaseUrlInput(saved?.baseUrl ?? activeProvider.baseUrl);
      setModel(isPreset ? activeModel : CUSTOM_MODEL);
      setCustomMode(!isPreset && activeProvider.customModelAllowed);
      setCustomModelInput(isPreset ? "" : activeModel);
      setReasoning(saved?.reasoning ?? "high");
      setSessionOnly(saved?.persistence === "session");
      setSavedKey(saved?.apiKey ?? "");
      setHasSaved(Boolean(saved));
      setSavedPersistence(saved?.persistence ?? null);
      setKeyInput("");
      setReveal(false);
      setError(null);
      node.showModal();
    } else if (!open && node.open) node.close();
  }, [open]);

  function handleProviderChange(nextId: ModelProviderId) {
    const next = getModelProvider(nextId);
    setProviderId(next.id);
    setBaseUrlInput(next.baseUrl);
    setModel(next.models[0].id);
    setCustomMode(false);
    setCustomModelInput("");
    setError(null);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const resolvedBase = provider.editableBaseUrl ? normalizeLocalBaseUrl(baseUrlInput) : provider.baseUrl;
    if (!resolvedBase) {
      setError("本地接口仅支持 http(s)://127.0.0.1 或 localhost（路径为空或 /v1）。");
      return;
    }
    const chosenModel = (customMode ? customModelInput : model).trim();
    if (!chosenModel || (provider.id !== "deepseek" && !isValidOpenModelId(chosenModel))) {
      setError("请填写有效的模型名称（如 Qwen/Qwen3-32B 或 qwen3:14b）。");
      return;
    }
    const enteredKey = keyInput.trim();
    const apiKey = enteredKey || (provider.requiresKey ? savedKey.trim() : (hasSaved && !provider.requiresKey ? savedKey.trim() : ""));
    if (provider.requiresKey && (!apiKey || apiKey.length > 256 || !keyShape.test(apiKey))) {
      setError(`请填写有效的 ${provider.shortLabel} API Key。`);
      return;
    }
    if (apiKey && (apiKey.length > 256 || !keyShape.test(apiKey))) {
      setError("API Key 格式无效，请检查是否包含空格或非法字符。");
      return;
    }
    try {
      saveModelSettings({
        provider: provider.id,
        baseUrl: resolvedBase,
        model: chosenModel,
        apiKey,
        reasoning,
        persistence: sessionOnly ? "session" : "local",
      });
    } catch {
      setError("浏览器无法保存设置，请检查是否禁止了本地存储。");
      return;
    }
    onClose();
  }

  function clear() {
    clearModelSettings();
    setSavedKey("");
    setHasSaved(false);
    setSavedPersistence(null);
    setKeyInput("");
    setError(null);
  }

  const shownModel = customMode ? CUSTOM_MODEL : model;
  const websiteHost = displayHost(provider.websiteUrl);
  const shortNote = provider.id === "deepseek"
    ? "官方接口，工具调用稳定"
    : provider.id === "local"
      ? "本地后端运行可用，建议 14B+"
      : "开源权重接口，建议 32B+";

  return <dialog ref={dialog} className="modal model-settings-dialog" onClose={onClose} aria-labelledby="model-settings-title">
    <form onSubmit={save}>
      <div className="modal-heading">
        <h2 id="model-settings-title">模型设置</h2>
        <button type="button" className="icon-button" aria-label="关闭模型设置" onClick={onClose}><X size={18}/></button>
      </div>

      <div className="ms-section">
        <div className="ms-field-head">
          <span>服务商</span>
          <small className="ms-host-hint">
            <a
              className="ms-site-link"
              href={provider.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`打开 ${provider.shortLabel} 官网（${websiteHost}）`}
            >
              <span>{websiteHost}</span>
              <ArrowUpRight size={11} aria-hidden="true"/>
            </a>
            <span>· {shortNote}</span>
          </small>
        </div>
        <div className="ms-provider-tabs" role="radiogroup" aria-label="选择模型服务商">
          {MODEL_PROVIDERS.map(item => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={provider.id === item.id}
              className={`ms-provider-tab${provider.id === item.id ? " is-active" : ""}`}
              onClick={() => handleProviderChange(item.id)}
            >
              {item.shortLabel}
            </button>
          ))}
        </div>
      </div>

      {provider.editableBaseUrl && <label className="ms-field">
        <span className="ms-field-head"><span>接口地址</span><small>兼容 /v1</small></span>
        <input type="text" value={baseUrlInput} autoComplete="off" spellCheck={false} placeholder="http://127.0.0.1:11434/v1" onChange={event => setBaseUrlInput(event.target.value)}/>
      </label>}

      <div className={provider.supportsReasoning ? "ms-pair" : "ms-single"}>
        <label className="ms-field">
          <span className="ms-field-head"><span>模型</span></span>
          <select value={shownModel} onChange={event => {
            const next = event.target.value;
            if (next === CUSTOM_MODEL) {
              setCustomMode(true);
              setModel(CUSTOM_MODEL);
            } else {
              setCustomMode(false);
              setModel(next);
            }
          }}>
            {provider.models.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            {provider.customModelAllowed && <option value={CUSTOM_MODEL}>自定义模型…</option>}
          </select>
        </label>
        {provider.supportsReasoning && <label className="ms-field">
          <span className="ms-field-head"><span>思考强度</span></span>
          <select value={reasoning} onChange={event => setReasoning(event.target.value as ReasoningEffort)}>
            {REASONING_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>}
      </div>

      {customMode && <label className="ms-field">
        <span className="ms-field-head"><span>模型 ID</span></span>
        <input type="text" value={customModelInput} autoComplete="off" spellCheck={false} placeholder={provider.models[0]?.id ?? "输入模型名称"} onChange={event => setCustomModelInput(event.target.value)}/>
      </label>}

      <label className="ms-field">
        <span className="ms-field-head">
          <span>{provider.requiresKey ? "API Key" : "API Key（可选）"}</span>
          {hasSaved && <span className="ms-saved-badge">{savedKey ? maskKey(savedKey) : "免密钥"} · {savedPersistence === "session" ? "当前标签" : "本浏览器"}</span>}
        </span>
        <span className="model-settings-keyline">
          <input type={reveal ? "text" : "password"} value={keyInput} autoComplete="off" spellCheck={false} placeholder={savedKey ? "留空沿用当前密钥" : provider.requiresKey ? "输入 API Key" : "本地服务通常留空"} onChange={event => setKeyInput(event.target.value)}/>
          <button type="button" className="model-settings-reveal" aria-label={reveal ? "隐藏密钥" : "显示密钥"} aria-pressed={reveal} onClick={() => setReveal(value => !value)}>{reveal ? <EyeOff size={16} aria-hidden="true"/> : <Eye size={16} aria-hidden="true"/>}</button>
        </span>
      </label>

      <label className="model-settings-check" htmlFor="model-settings-session">
        <input id="model-settings-session" type="checkbox" checked={sessionOnly} onChange={event => setSessionOnly(event.target.checked)}/>
        <span>仅当前标签页保留</span>
      </label>

      {error && <p className="model-settings-error" role="alert">{error}</p>}
      <div className="modal-footer">
        <button type="button" className="text-button" onClick={clear} disabled={!hasSaved && !keyInput}>清除</button>
        <div className="ms-actions">
          <button type="button" className="outline-button ms-cancel" onClick={onClose}>取消</button>
          <button type="submit" className="primary-button">保存</button>
        </div>
      </div>
    </form>
  </dialog>;
}
