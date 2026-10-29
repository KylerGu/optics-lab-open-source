"""Local research/build records; never receive credentials or private reasoning."""
import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from uuid import uuid4


DEBUG_ROOT = Path(__file__).resolve().parents[1] / 'output' / 'runtime' / 'debug'
_lock = Lock()


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class DebugRun:
    def __init__(self, area, request, settings, builder_settings=None):
        self.path = DEBUG_ROOT / ('run-' + uuid4().hex + '.jsonl')
        self.record('request', area=area, request=request.model_dump(),
                    model=settings.model, reasoningEffort=settings.reasoning_effort,
                    builderEffort=builder_settings.reasoning_effort if builder_settings else None)
        try:
            with _lock:
                for path in sorted(DEBUG_ROOT.glob('run-*.jsonl'), key=lambda p: p.stat().st_mtime, reverse=True)[20:]:
                    path.unlink()
        except OSError:
            pass

    def record(self, event, **data):
        try:
            row = json.dumps({'time': timestamp(), 'event': event, **data}, ensure_ascii=False, allow_nan=False)
            with _lock:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with self.path.open('a', encoding='utf-8') as file:
                    file.write(row + '\n')
        except (OSError, TypeError, ValueError):
            pass  # Debugging must never break a conversation or calculation.


def save_snapshot(area, state):
    if area not in {'research', 'builder'}:
        return False
    try:
        with _lock:
            DEBUG_ROOT.mkdir(parents=True, exist_ok=True)
            path = DEBUG_ROOT / (area + '-latest.json')
            try:
                previous = json.loads(path.read_text(encoding='utf-8')).get('current')
            except (OSError, ValueError):
                previous = None
            if previous == state:
                return True
            text = json.dumps({'time': timestamp(), 'previous': previous, 'current': state}, ensure_ascii=False, allow_nan=False)
            temporary = path.with_suffix('.tmp')
            temporary.write_text(text, encoding='utf-8')
            temporary.replace(path)
        return True
    except (OSError, TypeError, ValueError):
        return False
