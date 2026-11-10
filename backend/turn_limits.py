"""Single place to tune assistant time limits.

Connect, read, write and pool bound one provider HTTP call.
Read is the longest quiet gap between response bytes, not the whole turn.
Turn budgets bound one user round, including later tool calls.
"""
import logging
import time

import httpx

# One provider call.
CONNECT_SECONDS = 10.0
READ_SECONDS = 60.0
WRITE_SECONDS = 30.0
POOL_SECONDS = 15.0

# One user round. Scene assistant and legacy /api/agent/chat.
SCENE_TURN_SECONDS = 120.0
# Optical-path builder and the experiment-inquiry assistant (about 6 minutes).
LONG_TURN_SECONDS = 360.0

TIMEOUT_MESSAGE = "本轮超时，可以重试。"

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


def log_turn(route, started, *, timed_out, cancelled):
    """Duration only. Never include the prompt, the reply, or credentials."""
    log.info(
        "assistant_turn route=%s elapsed_s=%.3f timed_out=%s cancelled=%s",
        route,
        time.monotonic() - started,
        bool(timed_out),
        bool(cancelled),
    )
