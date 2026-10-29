"""Private local configuration. Never return credentials to the browser."""
from dataclasses import dataclass
import os

import httpx
from pathlib import Path
from urllib.parse import urlsplit

ENV_PATH = Path(__file__).resolve().parents[1] / ".env"


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
        # Bound connection establishment and sending, not model thinking/output.
        return httpx.Timeout(connect=15, read=None, write=30, pool=15)

    @property
    def configured(self):
        try:
            endpoint = urlsplit(self.base_url)
            return bool(self.api_key.strip() and self.model.strip() and endpoint.scheme in {"http", "https"} and endpoint.hostname and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment and (not self.uses_deepseek or self.reasoning_effort in {'none', 'low', 'high', 'max'}))
        except ValueError:
            return False


def get_settings(*, research=False, research_build=False) -> Settings:
    # The previous local configuration remains compatible; new providers use AI_*.
    values = {}
    try:
        for line in ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.strip().partition("=")
            if separator and key in {"AI_API_KEY", "AI_MODEL", "AI_BASE_URL", "AI_REASONING_EFFORT", "AI_RESEARCH_REASONING_EFFORT", "AI_RESEARCH_BUILD_REASONING_EFFORT", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"}:
                values[key] = value.strip().strip('"\'')
    except FileNotFoundError:
        pass
    def setting(key, default=""):
        return os.environ.get(key, values.get(key, default)).strip()

    effort = setting('AI_RESEARCH_BUILD_REASONING_EFFORT', 'high') if research_build else setting('AI_RESEARCH_REASONING_EFFORT', 'high') if research else setting('AI_REASONING_EFFORT', 'high')
    if any(key in os.environ or key in values for key in {"AI_API_KEY", "AI_MODEL", "AI_BASE_URL"}):
        return Settings(api_key=setting("AI_API_KEY"), model=setting("AI_MODEL"), base_url=setting("AI_BASE_URL").rstrip("/"), reasoning_effort=effort.lower())
    return Settings(
        api_key=os.environ.get("DEEPSEEK_API_KEY", values.get("DEEPSEEK_API_KEY", "")).strip(),
        model=os.environ.get("DEEPSEEK_MODEL", values.get("DEEPSEEK_MODEL", "deepseek-flash")).strip(),
        reasoning_effort=effort.lower(),
    )
