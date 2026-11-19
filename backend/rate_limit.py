"""In-memory sliding-window rate limiter for requests using the server AI key."""
from collections import deque
from threading import Lock
import time


class ServerKeyRateLimiter:
    """Thread-safe sliding-window limiter applied only to server-key fallback calls."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._lock = Lock()
        self._ip_minute: dict[str, deque[float]] = {}
        self._ip_day: dict[str, deque[float]] = {}
        self._global_day: deque[float] = deque()

    def reset(self) -> None:
        with self._lock:
            self._ip_minute.clear()
            self._ip_day.clear()
            self._global_day.clear()

    @staticmethod
    def _prune(bucket: deque[float], cutoff: float) -> None:
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()

    def consume(
        self,
        client_id: str,
        *,
        minute_limit: int,
        ip_daily_limit: int,
        global_daily_limit: int,
    ) -> str | None:
        """Record one server-key request or return a user-facing refusal message."""
        now = self._clock()
        minute_cutoff = now - 60.0
        day_cutoff = now - 86400.0
        key = client_id or "unknown"

        with self._lock:
            self._prune(self._global_day, day_cutoff)
            if global_daily_limit > 0 and len(self._global_day) >= global_daily_limit:
                return "今日公共演示密钥全站使用次数已达上限，请在右上角「模型设置」中填入您自己的密钥继续使用。"

            minute_bucket = self._ip_minute.get(key)
            if minute_bucket is not None:
                self._prune(minute_bucket, minute_cutoff)
                if not minute_bucket:
                    del self._ip_minute[key]
                    minute_bucket = None
            if minute_limit > 0 and minute_bucket is not None and len(minute_bucket) >= minute_limit:
                return "演示密钥请求过于频繁，请稍后再试；或在右上角「模型设置」中填入您自己的密钥。"

            day_bucket = self._ip_day.get(key)
            if day_bucket is not None:
                self._prune(day_bucket, day_cutoff)
                if not day_bucket:
                    del self._ip_day[key]
                    day_bucket = None
            if ip_daily_limit > 0 and day_bucket is not None and len(day_bucket) >= ip_daily_limit:
                return "今日演示密钥使用次数已达上限，请在右上角「模型设置」中填入您自己的密钥继续使用。"

            if global_daily_limit > 0:
                self._global_day.append(now)
            if minute_limit > 0:
                self._ip_minute.setdefault(key, deque()).append(now)
            if ip_daily_limit > 0:
                self._ip_day.setdefault(key, deque()).append(now)
            return None
