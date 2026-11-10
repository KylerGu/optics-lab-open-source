"""Single place to tune assistant time limits.

Read is the stall detector: no bytes from the provider for this long means the
call is stuck. Tool work and a stream that keeps arriving are not stalls.
Turn budgets are only a last-resort cap. Render allows an HTTP response to
stay open for 100 minutes; these caps stop sooner so the turn can end cleanly
and keep its progress. Browser abort timers must stay a couple of minutes
longer than the matching budget (scene 12 min, builder and research 33 min).
"""
from threading import Event
import logging
import time

import httpx

# One provider call.
CONNECT_SECONDS = 10.0
READ_SECONDS = 60.0
WRITE_SECONDS = 30.0
POOL_SECONDS = 15.0

# Safety caps, not the normal way a turn ends.
# Scene assistant and legacy /api/agent/chat: 10 minutes.
SCENE_TURN_SECONDS = 600.0
# Optical-path builder and experiment inquiry: 30 minutes (top of the 20–30 minute range).
LONG_TURN_SECONDS = 1800.0

STALL_MESSAGE = "模型长时间无响应，已停止。"
BUDGET_MESSAGE = "本轮已达时长上限，已保留进度，可点继续。"
STOP_MESSAGE = "已停止"


def finished_steps(steps):
    """Drop a phase marker that was still running. Keep steps that already finished."""
    kept = []
    for step in steps or []:
        name = str(step.get("name") or "")
        summary = str(step.get("summary") or "")
        if name.startswith("phase_") or name == "builder_start" or summary.startswith("正在"):
            continue
        if summary:
            kept.append(step)
    return kept


class TurnStop:
    """Callable cancel flag. budget=True means the safety cap, not a user stop."""

    def __init__(self):
        self._event = Event()
        self.budget = False
        self.reason = "ok"

    def __call__(self):
        return self._event.is_set()

    def is_set(self):
        return self._event.is_set()

    def set(self):
        if self.reason == "ok":
            self.reason = "cancel"
        self._event.set()

    def expire(self):
        self.budget = True
        self.reason = "budget"
        self._event.set()

    def stall(self):
        self.reason = "stall"

log = logging.getLogger("optics.assistant")
log.setLevel(logging.INFO)
if not log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    log.addHandler(_handler)
    log.propagate = False


def provider_timeout():
    return httpx.Timeout(
        connect=CONNECT_SECONDS,
        read=READ_SECONDS,
        write=WRITE_SECONDS,
        pool=POOL_SECONDS,
    )


def log_turn(route, started, *, timed_out, cancelled, reason="ok"):
    """Duration only. Never include the prompt, the reply, or credentials."""
    log.info(
        "assistant_turn route=%s elapsed_s=%.3f timed_out=%s cancelled=%s reason=%s",
        route,
        time.monotonic() - started,
        bool(timed_out),
        bool(cancelled),
        reason,
    )
