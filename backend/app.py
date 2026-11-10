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
from .settings import ByokRejected, get_settings, settings_for_request
from .research import FocusSearchRequest, search_focus
from .tolerance import ToleranceRequest, run_tolerance
from .spatial import SpatialRequest, trace
from .spatial_agent import SpatialAgentRequest, run_spatial_agent
from .research_agent import ResearchAgentRequest, run_research_agent
from .local_debug import DebugRun, save_snapshot

app = FastAPI(title="光学智研计算服务", version="0.6.0")
agent_slots = BoundedSemaphore(2)
research_slots = BoundedSemaphore(2)
spatial_agent_slots = BoundedSemaphore(2)
research_agent_slots = BoundedSemaphore(2)
research_requests = {}
research_requests_lock = Lock()
STREAM_KEEPALIVE_SECONDS = 10
UNCONFIGURED = "请先在「模型设置」中填写你的 DeepSeek API Key。"


def request_settings(request: Request, *, research=False, research_build=False):
    try:
        return settings_for_request(getattr(request, "headers", None), research=research, research_build=research_build, loader=get_settings)
    except ByokRejected as error:
        raise HTTPException(status_code=422, detail=error.message) from None


class ResearchCancelRequest(BaseModel):
    requestId: str = Field(min_length=1, max_length=100)


@app.post('/api/research/agent/cancel')
async def cancel_research(document: ResearchCancelRequest):
    with research_requests_lock:
        stopped = research_requests.get(document.requestId)
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
    events, stopped = Queue(), Event()
    debug = DebugRun('builder', document, settings)
    def report(step):
        debug.record('progress', step=step)
        events.put({'type': 'progress', 'step': step})
    def worker():
        try:
            reply = run_spatial_agent(document, settings, progress=report, cancelled=stopped.is_set, debug=debug)
            debug.record('reply', reply=reply)
            events.put({"type": "reply", "reply": reply})
        except AgentError as error:
            debug.record('error', message=error.message, status=error.status)
            events.put({"type": "error", "message": error.message})
        except Exception as error:
            debug.record('error', errorType=type(error).__name__)
            events.put({"type": "error", "message": "本轮设计未完成，装置未修改。请重试。"})
        finally:
            debug.record('finished', stopped=stopped.is_set())
            spatial_agent_slots.release()
            events.put(None)
    async def stream():
        last_sent = time.monotonic()
        try:
            while not stopped.is_set():
                if await request.is_disconnected():
                    break
                try:
                    event = events.get_nowait()
                except Empty:
                    # Blank NDJSON lines keep proxies connected during model reasoning.
                    if time.monotonic() - last_sent >= STREAM_KEEPALIVE_SECONDS:
                        yield "\n"
                        last_sent = time.monotonic()
                    await asyncio.sleep(.08)
                    continue
                if event is None:
                    break
                yield json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n"
                last_sent = time.monotonic()
        finally:
            stopped.set()
    Thread(target=worker, daemon=True).start()
    return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


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
    events, stopped = Queue(), Event()
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
            reply = run_research_agent(document, settings, progress=report, cancelled=stopped.is_set, builder_settings=builder_settings, debug=debug)
            debug.record('reply', reply=reply)
            events.put({"type": "reply", "reply": reply})
        except AgentError as error:
            debug.record('error', message=error.message, status=error.status)
            events.put({"type": "error", "message": error.message})
        except Exception as error:
            debug.record('error', errorType=type(error).__name__)
            events.put({"type": "error", "message": "本轮研究未完成，请重试。"})
        finally:
            debug.record('finished', stopped=stopped.is_set())
            with research_requests_lock:
                if research_requests.get(document.requestId) is stopped:
                    del research_requests[document.requestId]
            research_agent_slots.release()
            events.put(None)
    async def stream():
        last_sent = time.monotonic()
        try:
            while not stopped.is_set():
                if await request.is_disconnected():
                    break
                try:
                    event = events.get_nowait()
                except Empty:
                    # Blank NDJSON lines keep proxies connected during model reasoning.
                    if time.monotonic() - last_sent >= STREAM_KEEPALIVE_SECONDS:
                        yield "\n"
                        last_sent = time.monotonic()
                    await asyncio.sleep(.08)
                    continue
                if event is None:
                    break
                yield json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n"
                last_sent = time.monotonic()
        finally:
            stopped.set()
    Thread(target=worker, daemon=True).start()
    return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.post("/api/agent/chat")
def agent_chat(document: AgentRequest, request: Request):
    settings = request_settings(request)
    if not settings.configured:
        raise HTTPException(status_code=503, detail=UNCONFIGURED)
    if not agent_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="助手正在处理其他请求，请稍后重试。")
    try:
        return run_agent(document, settings)
    except AgentError as error:
        raise HTTPException(status_code=error.status, detail=error.message) from None
    finally:
        agent_slots.release()


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
def scene_chat(document: SceneAgentRequest, request: Request):
    settings = request_settings(request)
    if not settings.configured:
        raise HTTPException(status_code=503, detail=UNCONFIGURED)
    if not agent_slots.acquire(blocking=False):
        raise HTTPException(status_code=429, detail='助手正在处理其他请求，请稍后重试。')
    try:
        return run_scene_agent(document, settings)
    except AgentError as error:
        raise HTTPException(status_code=error.status, detail=error.message) from None
    finally:
        agent_slots.release()
