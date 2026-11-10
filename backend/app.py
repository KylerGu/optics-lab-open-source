import asyncio
import json
import time
from queue import Queue, Empty
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from threading import BoundedSemaphore, Thread, Event, Lock
from pydantic import BaseModel, Field

from .models import SimulationRequest
from .optics import MODEL_VERSION, simulate
from .agent import AgentError, AgentRequest, run_agent
from .settings import ByokRejected, get_settings, production_mode, settings_for_request
from .research import FocusSearchRequest, search_focus
from .tolerance import ToleranceRequest, run_tolerance
from .spatial import SpatialRequest, trace
from .spatial_agent import SpatialAgentRequest, run_spatial_agent
from .research_agent import ResearchAgentRequest, run_research_agent
from .research_http import ResearchClient
from .local_debug import DebugRun, save_snapshot
from . import turn_limits
from .turn_limits import BUDGET_MESSAGE, STALL_MESSAGE, TurnStop, log_turn

# Kept off unless APP_ENV=production. style-src allows React and KaTeX inline styles.
# connect-src stays on this origin: the browser never calls DeepSeek itself.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=15552000",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "worker-src 'self' blob:; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    ),
}


def fastapi_docs_options():
    if production_mode():
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {}


def _is_api_docs(path):
    return path == "/openapi.json" or path in {"/docs", "/redoc"} or path.startswith("/docs/") or path.startswith("/redoc/")


class ProductionGuard:
    """Production-only docs block and security headers.

    When APP_ENV is not production this is a straight ASGI pass-through, so
    local streaming responses are not wrapped or buffered.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not production_mode():
            await self.app(scope, receive, send)
            return
        if _is_api_docs(scope.get("path", "")):
            response = JSONResponse(status_code=404, content={"detail": "Not Found"})
            for key, value in SECURITY_HEADERS.items():
                response.headers[key] = value
            await response(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                present = {name.lower() for name, _value in headers}
                for key, value in SECURITY_HEADERS.items():
                    encoded = key.lower().encode("latin-1")
                    if encoded not in present:
                        headers.append((encoded, value.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


app = FastAPI(title="光学智研计算服务", version="0.6.0", debug=False, **fastapi_docs_options())
app.add_middleware(ProductionGuard)
agent_slots = BoundedSemaphore(2)
research_slots = BoundedSemaphore(2)
spatial_agent_slots = BoundedSemaphore(2)
research_agent_slots = BoundedSemaphore(2)
research_requests = {}
research_requests_lock = Lock()
spatial_requests = {}
spatial_requests_lock = Lock()
STREAM_KEEPALIVE_SECONDS = 10
UNCONFIGURED = "请先在「模型设置」中填写你的 DeepSeek API Key。"


def request_settings(request: Request, *, research=False, research_build=False):
    try:
        return settings_for_request(getattr(request, "headers", None), research=research, research_build=research_build, loader=get_settings)
    except ByokRejected as error:
        raise HTTPException(status_code=422, detail=error.message) from None


def note_failure(events, error, timed_out, stopped):
    message = error.message
    if message == STALL_MESSAGE:
        stopped.stall()
    elif message == BUDGET_MESSAGE or timed_out.is_set():
        timed_out.set()
        stopped.expire()
        message = BUDGET_MESSAGE
    elif stopped.reason == "ok":
        stopped.reason = "error"
    events.put({"type": "error", "message": message})


async def ndjson_stream(request, events, stopped, timed_out, deadline_at, started, route):
    last_sent = time.monotonic()
    try:
        while True:
            if await request.is_disconnected():
                stopped.set()
                break
            if not timed_out.is_set() and time.monotonic() >= deadline_at:
                timed_out.set()
                stopped.expire()
            try:
                event = events.get_nowait()
            except Empty:
                if time.monotonic() - last_sent >= STREAM_KEEPALIVE_SECONDS:
                    yield "\n"
                    last_sent = time.monotonic()
                await asyncio.sleep(.08)
                continue
            if event is None:
                break
            if timed_out.is_set() and isinstance(event, dict) and event.get("type") == "error" and event.get("message") != STALL_MESSAGE:
                event = {"type": "error", "message": BUDGET_MESSAGE}
            yield json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n"
            last_sent = time.monotonic()
    finally:
        reason = stopped.reason if stopped.reason != "ok" else "cancel" if stopped.is_set() else "ok"
        stopped.set()
        log_turn(route, started, timed_out=reason in {"stall", "budget"}, cancelled=reason == "cancel", reason=reason)


async def finish_json_turn(request, slot, started, deadline_at, route, work):
    """Run one JSON assistant turn. Disconnect or the deadline closes the upstream call."""
    stopped, done = TurnStop(), Event()
    timed_out = Event()
    outcome = {}

    def wrapped():
        try:
            outcome["reply"] = work(stopped)
        except AgentError as error:
            outcome["error"] = error
            if error.message == STALL_MESSAGE:
                stopped.stall()
            elif error.message == BUDGET_MESSAGE:
                timed_out.set()
                stopped.expire()
        except Exception:
            outcome["error"] = AgentError("本轮未完成，请重试。")
        finally:
            slot.release()
            done.set()

    Thread(target=wrapped, daemon=True).start()
    try:
        while not done.is_set():
            if await request.is_disconnected():
                stopped.set()
                break
            if time.monotonic() >= deadline_at:
                timed_out.set()
                stopped.expire()
            await asyncio.sleep(0.05)
        while not done.is_set():
            await asyncio.sleep(0.05)
    finally:
        if not done.is_set():
            stopped.set()
    error = outcome.get("error")
    reply = outcome.get("reply")
    reason = stopped.reason
    if reason == "ok" and error is not None:
        reason = "error"
    elif reason == "ok" and stopped.is_set() and reply is None:
        reason = "cancel"
    timed = reason == "budget" or timed_out.is_set()
    log_turn(route, started, timed_out=reason in {"stall", "budget"}, cancelled=reason == "cancel", reason=reason)
    if reply is not None and not timed:
        return reply
    if isinstance(error, AgentError) and error.message == STALL_MESSAGE:
        raise HTTPException(status_code=504, detail=STALL_MESSAGE)
    if timed:
        raise HTTPException(status_code=504, detail=BUDGET_MESSAGE)
    if error is not None:
        raise HTTPException(status_code=error.status, detail=error.message) from None
    raise HTTPException(status_code=499, detail="已停止本轮请求。")


class ResearchCancelRequest(BaseModel):
    requestId: str = Field(min_length=1, max_length=100)


@app.post('/api/research/agent/cancel')
async def cancel_research(document: ResearchCancelRequest):
    with research_requests_lock:
        stopped = research_requests.get(document.requestId)
        if stopped is not None:
            stopped.set()
    return {'stopped': stopped is not None}


@app.post('/api/spatial/agent/cancel')
async def cancel_spatial(document: ResearchCancelRequest):
    with spatial_requests_lock:
        stopped = spatial_requests.get(document.requestId)
        if stopped is not None:
            stopped.set()
    return {'stopped': stopped is not None}


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _exception):
    return JSONResponse(status_code=422, content={"detail": "实验数据无效，请检查元件参数、单位与文件格式。"})


@app.get("/api/health")
def health():
    return {"status": "ok", "modelVersion": MODEL_VERSION}


@app.post('/api/debug/snapshot')
async def debug_snapshot(request: Request):
    if production_mode():
        raise HTTPException(status_code=404, detail="Not Found")
    body = await request.body()
    if len(body) > 8_000_000:
        raise HTTPException(status_code=413, detail='调试快照过大。')
    try:
        data = json.loads(body)
        if not isinstance(data, dict) or data.get('area') not in {'research', 'builder'} or not isinstance(data.get('state'), dict):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail='调试快照无效。') from None
    return {'saved': save_snapshot(data['area'], data['state'])}


@app.post("/api/simulate")
def run_simulation(request: SimulationRequest):
    try:
        return simulate(request.experiment, request.revision)
    except (ValueError, OverflowError, ZeroDivisionError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/spatial/simulate")
def spatial_simulation(request: SpatialRequest):
    try:
        return trace(request.experiment, request.revision)
    except (ValueError, OverflowError, ZeroDivisionError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def _status(request: Request):
    try:
        settings = settings_for_request(getattr(request, "headers", None), loader=get_settings)
    except ByokRejected:
        return {"configured": False}
    return {"configured": settings.configured}


@app.get("/api/agent/status")
def agent_status(request: Request):
    return _status(request)


@app.get("/api/spatial/agent/status")
def spatial_agent_status(request: Request):
    return _status(request)


@app.post("/api/spatial/agent/chat")
async def spatial_agent_chat(document: SpatialAgentRequest, request: Request):
    settings = request_settings(request)
    if not settings.configured:
        raise HTTPException(status_code=503, detail=UNCONFIGURED)
    if not spatial_agent_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="光路设计正在运行，请稍后重试。")
    events, stopped, timed_out = Queue(), TurnStop(), Event()
    started = time.monotonic()
    deadline_at = started + turn_limits.LONG_TURN_SECONDS
    with spatial_requests_lock:
        if document.requestId in spatial_requests:
            spatial_agent_slots.release()
            raise HTTPException(status_code=409, detail='这条搭建请求已经在运行。')
        spatial_requests[document.requestId] = stopped
    debug = DebugRun('builder', document, settings)
    def report(step):
        debug.record('progress', step=step)
        events.put({'type': 'progress', 'step': step})
    def worker():
        try:
            reply = run_spatial_agent(document, settings, progress=report, cancelled=stopped, debug=debug)
            debug.record('reply', reply=reply)
            events.put({"type": "reply", "reply": reply})
        except AgentError as error:
            debug.record('error', message=error.message, status=error.status)
            note_failure(events, error, timed_out, stopped)
        except Exception as error:
            debug.record('error', errorType=type(error).__name__)
            events.put({"type": "error", "message": BUDGET_MESSAGE if timed_out.is_set() else "本轮设计未完成，装置未修改。请重试。"})
        finally:
            debug.record('finished', stopped=stopped.is_set())
            with spatial_requests_lock:
                if spatial_requests.get(document.requestId) is stopped:
                    del spatial_requests[document.requestId]
            spatial_agent_slots.release()
            events.put(None)
    Thread(target=worker, daemon=True).start()
    return StreamingResponse(ndjson_stream(request, events, stopped, timed_out, deadline_at, started, "builder"), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.post("/api/research/focus")
def focus_search(request: FocusSearchRequest):
    if not research_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="设计计算正在运行，请稍后重试。")
    try:
        return {"requestId": request.requestId, "design": search_focus(request.experiment, request.goal)}
    except (ValueError, OverflowError, ZeroDivisionError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        research_slots.release()


@app.post("/api/research/agent/chat")
async def research_agent_chat(document: ResearchAgentRequest, request: Request):
    settings = request_settings(request, research=True)
    if not settings.configured:
        raise HTTPException(status_code=503, detail=UNCONFIGURED)
    if not research_agent_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="实验探究助手正在处理其他问题，请稍后重试。")
    events, stopped, timed_out = Queue(), TurnStop(), Event()
    started = time.monotonic()
    deadline_at = started + turn_limits.LONG_TURN_SECONDS
    with research_requests_lock:
        if document.requestId in research_requests:
            research_agent_slots.release()
            raise HTTPException(status_code=409, detail='这条研究请求已经在运行。')
        research_requests[document.requestId] = stopped
    builder_settings = request_settings(request, research_build=True)
    debug = DebugRun('research', document, settings, builder_settings)
    def report(step):
        debug.record('progress', step=step)
        events.put({'type': 'progress', 'step': step})
    def worker():
        try:
            reply = run_research_agent(document, settings, progress=report, cancelled=stopped, builder_settings=builder_settings, debug=debug)
            debug.record('reply', reply=reply)
            events.put({"type": "reply", "reply": reply})
        except AgentError as error:
            debug.record('error', message=error.message, status=error.status)
            note_failure(events, error, timed_out, stopped)
        except Exception as error:
            debug.record('error', errorType=type(error).__name__)
            events.put({"type": "error", "message": BUDGET_MESSAGE if timed_out.is_set() else "本轮研究未完成，请重试。"})
        finally:
            debug.record('finished', stopped=stopped.is_set())
            with research_requests_lock:
                if research_requests.get(document.requestId) is stopped:
                    del research_requests[document.requestId]
            research_agent_slots.release()
            events.put(None)
    Thread(target=worker, daemon=True).start()
    return StreamingResponse(ndjson_stream(request, events, stopped, timed_out, deadline_at, started, "research"), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.post("/api/agent/chat")
async def agent_chat(document: AgentRequest, request: Request):
    settings = request_settings(request)
    if not settings.configured:
        raise HTTPException(status_code=503, detail=UNCONFIGURED)
    if not agent_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="助手正在处理其他请求，请稍后重试。")
    started = time.monotonic()
    deadline_at = started + turn_limits.SCENE_TURN_SECONDS

    def work(stopped):
        client = ResearchClient(stopped, streaming=False, deadline=deadline_at)
        try:
            return run_agent(document, settings, client=client)
        finally:
            client.close()

    return await finish_json_turn(request, agent_slots, started, deadline_at, "agent", work)


@app.post("/api/research/tolerance")
def tolerance_study(request: ToleranceRequest):
    if not research_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="探究计算正在运行，请稍后重试。")
    try:
        return {"requestId": request.requestId, "study": run_tolerance(request.experiment, request.tolerance, request.goal)}
    except (ValueError, OverflowError, ZeroDivisionError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        research_slots.release()


# Catalog scenes share these calculations with the formula library and assistant.
from .scene_physics import SceneRequest, calculate as calculate_scene, solve_formula
from .scene_agent import SceneAgentRequest, run_scene_agent
from .models import StrictModel


class SceneFormulaRequest(StrictModel):
    formulaId: str
    target: str
    values: dict


@app.post('/api/scenes/calculate')
def scene_calculation(request: SceneRequest):
    try:
        return calculate_scene(request.state, request.revision)
    except (ValueError, OverflowError, ZeroDivisionError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post('/api/scenes/formula')
def scene_formula(request: SceneFormulaRequest):
    try:
        return solve_formula(request.formulaId, request.target, request.values)
    except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post('/api/scenes/agent/chat')
async def scene_chat(document: SceneAgentRequest, request: Request):
    settings = request_settings(request)
    if not settings.configured:
        raise HTTPException(status_code=503, detail=UNCONFIGURED)
    if not agent_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail='助手正在处理其他请求，请稍后重试。')
    started = time.monotonic()
    deadline_at = started + turn_limits.SCENE_TURN_SECONDS

    def work(stopped):
        client = ResearchClient(stopped, streaming=False, deadline=deadline_at)
        try:
            return run_scene_agent(document, settings, client=client)
        finally:
            client.close()

    return await finish_json_turn(request, agent_slots, started, deadline_at, "scene", work)
