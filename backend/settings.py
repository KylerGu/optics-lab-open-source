"""Private local configuration. Never return credentials to the browser."""
from dataclasses import dataclass
import os
import re

from pathlib import Path
from urllib.parse import urlsplit

ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
# Browser BYOK may target official OpenAI-compatible cloud providers or loopback local runtimes in dev.
DEEPSEEK_BASE_URLS = frozenset({"https://api.deepseek.com", "https://api.deepseek.com/v1"})
CLOUD_BASE_URLS = DEEPSEEK_BASE_URLS | frozenset({
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://api.siliconflow.cn/v1",
    "https://openrouter.ai/api/v1",
})
DEEPSEEK_MODELS = frozenset({"deepseek-flash", "deepseek-v4-pro"})
REASONING_EFFORTS = frozenset({"none", "low", "high", "max"})
OPEN_MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
_CONFIG_KEYS = frozenset({
    "AI_API_KEY", "AI_MODEL", "AI_BASE_URL", "AI_REASONING_EFFORT", "AI_RESEARCH_REASONING_EFFORT",
    "AI_RESEARCH_BUILD_REASONING_EFFORT", "AI_ALLOW_SERVER_KEY", "AI_SERVER_KEY_MINUTE_LIMIT",
    "AI_SERVER_KEY_IP_DAILY_LIMIT", "AI_SERVER_KEY_DAILY_LIMIT", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL",
})
_TRUE_FLAGS = frozenset({"1", "true", "yes", "on"})
_DEFAULT_SERVER_MINUTE_LIMIT = 20
_DEFAULT_SERVER_IP_DAILY_LIMIT = 100
_DEFAULT_SERVER_DAILY_LIMIT = 500


def _is_local_base_url(base: str) -> bool:
    try:
        endpoint = urlsplit(base.rstrip("/"))
        _ = endpoint.port
    except ValueError:
        return False
    return bool(
        endpoint.scheme in {"http", "https"}
        and endpoint.hostname
        and endpoint.hostname.lower() in LOCAL_HOSTS
        and not endpoint.username
        and not endpoint.password
        and not endpoint.query
        and not endpoint.fragment
        and (endpoint.path or "").rstrip("/") in {"", "/v1"}
    )


class ByokRejected(Exception):
    """A browser-supplied model configuration cannot be used. The message is safe to show."""

    def __init__(self, message: str):
        self.message = message


@dataclass(frozen=True, repr=False)
class Settings:
    api_key: str
    model: str
    base_url: str = "https://api.deepseek.com"
    reasoning_effort: str = "high"

    @property
    def uses_deepseek(self):
        return self.base_url.rstrip('/') in {'https://api.deepseek.com', 'https://api.deepseek.com/v1'}

    @property
    def thinking_enabled(self):
        return self.uses_deepseek and self.reasoning_effort in {'low', 'high', 'max'}

    @property
    def output_token_limit(self):
        # Reasoning and the visible response share the generation allowance.
        if self.thinking_enabled and self.reasoning_effort == 'max':
            return 131072
        return 32768 if self.thinking_enabled else 3500

    @property
    def provider_timeout(self):
        # Numbers live in turn_limits so connect, read and turn budgets stay together.
        from .turn_limits import provider_timeout
        return provider_timeout()

    @property
    def configured(self):
        try:
            endpoint = urlsplit(self.base_url)
            has_credential = bool(self.api_key.strip()) or _is_local_base_url(self.base_url)
            return bool(has_credential and self.model.strip() and endpoint.scheme in {"http", "https"} and endpoint.hostname and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment and (not self.uses_deepseek or self.reasoning_effort in {'none', 'low', 'high', 'max'}))
        except ValueError:
            return False


def _file_values():
    # The previous local configuration remains compatible; new providers use AI_*.
    values = {}
    try:
        for line in ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.strip().partition("=")
            if separator and key in _CONFIG_KEYS:
                values[key] = value.strip().strip('"\'')
    except FileNotFoundError:
        pass
    return values


def _setting(values, key, default=""):
    return os.environ.get(key, values.get(key, default)).strip()


def production_mode() -> bool:
    """Public deployment switch. Only the process environment counts, not .env.

    APP_ENV=production turns off debug files and API docs. Any other value,
    including unset, keeps local development behavior.
    """
    return os.environ.get("APP_ENV", "").strip().lower() == "production"


def server_key_enabled() -> bool:
    """Private/self-hosted opt-in. Public deployments leave this unset."""
    return _setting(_file_values(), "AI_ALLOW_SERVER_KEY").lower() in _TRUE_FLAGS


def _positive_int_setting(values, key: str, default: int) -> int:
    raw = _setting(values, key)
    if not raw:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        return default
    return max(0, parsed)


def server_key_rate_limits() -> tuple[int, int, int]:
    """Return (per_ip_minute, per_ip_daily, global_daily) caps; 0 disables a tier."""
    values = _file_values()
    return (
        _positive_int_setting(values, "AI_SERVER_KEY_MINUTE_LIMIT", _DEFAULT_SERVER_MINUTE_LIMIT),
        _positive_int_setting(values, "AI_SERVER_KEY_IP_DAILY_LIMIT", _DEFAULT_SERVER_IP_DAILY_LIMIT),
        _positive_int_setting(values, "AI_SERVER_KEY_DAILY_LIMIT", _DEFAULT_SERVER_DAILY_LIMIT),
    )


def get_settings(*, research=False, research_build=False) -> Settings:
    values = _file_values()
    def setting(key, default=""):
        return _setting(values, key, default)

    effort = setting('AI_RESEARCH_BUILD_REASONING_EFFORT', 'high') if research_build else setting('AI_RESEARCH_REASONING_EFFORT', 'high') if research else setting('AI_REASONING_EFFORT', 'high')
    if any(key in os.environ or key in values for key in {"AI_API_KEY", "AI_MODEL", "AI_BASE_URL"}):
        return Settings(api_key=setting("AI_API_KEY"), model=setting("AI_MODEL"), base_url=setting("AI_BASE_URL").rstrip("/"), reasoning_effort=effort.lower())
    return Settings(
        api_key=os.environ.get("DEEPSEEK_API_KEY", values.get("DEEPSEEK_API_KEY", "")).strip(),
        model=os.environ.get("DEEPSEEK_MODEL", values.get("DEEPSEEK_MODEL", "deepseek-flash")).strip(),
        reasoning_effort=effort.lower(),
    )


def _header(headers, name):
    if headers is None:
        return ""
    getter = getattr(headers, "get", None)
    if getter is None:
        return ""
    try:
        value = getter(name)
    except Exception:
        return ""
    if not isinstance(value, str):
        return ""
    return value.strip()


def _byok_requested(headers) -> bool:
    return any(_header(headers, name) for name in ("x-ai-key", "x-ai-base-url", "x-ai-model", "x-ai-reasoning"))


def using_server_key(headers) -> bool:
    """True when this request falls back to the server-configured AI key."""
    return not _byok_requested(headers) and server_key_enabled()


def _user_settings(headers) -> Settings:
    # Headers are read once and never written to disk, logs, or the returned error text.
    base = _header(headers, "x-ai-base-url").rstrip("/") or "https://api.deepseek.com"
    is_local = _is_local_base_url(base)
    if base not in CLOUD_BASE_URLS and not is_local:
        raise ByokRejected("不支持该模型接口地址，请选择 DeepSeek、阿里云百炼、硅基流动、OpenRouter 或本地服务。")
    if is_local and production_mode():
        raise ByokRejected("公开演示服务不支持访问本地模型地址，请改用云端接口或在本地运行服务。")
    key = _header(headers, "x-ai-key")
    if key:
        if len(key) > 256 or any(ord(character) < 33 or ord(character) > 126 for character in key):
            raise ByokRejected("API Key 无效。请在「模型设置」中重新填写。")
    elif not is_local:
        raise ByokRejected("API Key 无效。请在「模型设置」中重新填写。")
    model = _header(headers, "x-ai-model")
    if base in DEEPSEEK_BASE_URLS:
        model = model or "deepseek-flash"
        if model not in DEEPSEEK_MODELS:
            raise ByokRejected("请选择 DeepSeek 当前提供的模型。")
    elif not model or not OPEN_MODEL_RE.fullmatch(model):
        raise ByokRejected("请填写有效的模型名称。")
    effort = (_header(headers, "x-ai-reasoning") or "high").lower()
    if effort not in REASONING_EFFORTS:
        raise ByokRejected("思考强度无效。")
    return Settings(api_key=key, model=model, base_url=base, reasoning_effort=effort)


def settings_for_request(headers, *, research=False, research_build=False, loader=None) -> Settings:
    """Credentials for one HTTP call.

    A browser configuration always wins and is restricted to approved cloud providers
    (or localhost runtimes in local non-production mode).
    The server environment key is used only when AI_ALLOW_SERVER_KEY is explicitly enabled
    and the browser did not send its own configuration. ``loader`` is the server-key
    reader (tests replace the app module's ``get_settings``).
    """
    if _byok_requested(headers):
        return _user_settings(headers)
    if server_key_enabled():
        return (loader or get_settings)(research=research, research_build=research_build)
    return Settings(api_key="", model="")
