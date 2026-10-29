"""Stage timings only: never log prompts, answers, reasoning or credentials."""
import json
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


class ResearchTrace:
    def __init__(self, path=None, debug=None):
        self.debug = debug
        self.path = Path(path) if path else Path(__file__).resolve().parents[1] / 'output' / 'runtime' / ('research-trace-' + uuid4().hex + '.jsonl')
        self.started = time.monotonic()
        self.stage = 'research'

    def record(self, event, **fields):
        row = {'event': event, 'stage': self.stage, 'elapsedSeconds': round(time.monotonic() - self.started, 3),
               'time': datetime.now(timezone.utc).isoformat(), **fields}
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open('a', encoding='utf-8') as file:
                file.write(json.dumps(row, ensure_ascii=False) + '\n')
        except OSError:
            pass

    @contextmanager
    def span(self, stage, **fields):
        previous, started = self.stage, time.monotonic()
        self.stage = stage
        self.record('start', **fields)
        try:
            yield
        except BaseException as error:
            self.record('end', status='error', errorType=type(error).__name__, durationSeconds=round(time.monotonic() - started, 3))
            raise
        else:
            self.record('end', status='ok', durationSeconds=round(time.monotonic() - started, 3))
        finally:
            self.stage = previous
