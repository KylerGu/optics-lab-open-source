"""Bounded, reproducible single-lens search using the existing physics engine."""
from datetime import datetime, timezone
from uuid import uuid4
import math

from pydantic import Field, model_validator

from .models import Experiment, Laser, Lens, Screen, StrictModel
from .optics import MODEL_VERSION, simulate

SEARCH_VERSION = "single-lens-screen-grid/1.0"
GRID_SIZE = 21


class SearchRange(StrictModel):
    start: float = Field(ge=0, le=5000)
    stop: float = Field(ge=0, le=5000)

    @model_validator(mode="after")
    def ordered(self):
        if self.start >= self.stop:
            raise ValueError("范围起点必须小于终点。")
        if self.stop - self.start < 1000 * math.ulp(max(1.0, abs(self.start), abs(self.stop))):
            raise ValueError("搜索范围过窄，无法区分计算采样点，请扩大范围。")
        return self


class FocusGoal(StrictModel):
    lensId: str = Field(min_length=1, max_length=100)
    screenId: str = Field(min_length=1, max_length=100)
    screenPositionMm: float = Field(gt=0, le=600)
    positionRange: SearchRange
    focalRange: SearchRange

    @model_validator(mode="after")
    def physical_bounds(self):
        if self.positionRange.stop >= self.screenPositionMm or self.focalRange.start < 1:
            raise ValueError("透镜搜索范围必须在观察屏之前，正焦距至少为1 mm。")
        return self


class FocusSearchRequest(StrictModel):
    requestId: str = Field(min_length=1, max_length=100)
    experiment: Experiment
    goal: FocusGoal


def candidate_experiment(experiment, goal, position, focal):
    document = experiment.model_dump()
    for element in document["elements"]:
        if element["id"] == goal.lensId:
            element.update(positionMm=position, focalLengthMm=focal)
        if element["id"] == goal.screenId:
            element["positionMm"] = goal.screenPositionMm
    return Experiment.model_validate(document)


def metrics(result, screen_id):
    screen = next(item for item in result["screens"] if item["elementId"] == screen_id)
    return {"radiusMm": screen["radiusMm"], "capturedFraction": screen["capturedFraction"],
            "quality": result["quality"], "warnings": result["warnings"]}


def axis(bounds):
    # Keep both specified endpoints exact, including floating-point inputs.
    return [bounds.start + (bounds.stop - bounds.start) * index / (GRID_SIZE - 1)
            if index < GRID_SIZE - 1 else bounds.stop for index in range(GRID_SIZE)]


def search_focus(experiment: Experiment, goal: FocusGoal):
    lenses = [item for item in experiment.elements if isinstance(item, Lens)]
    sources = [item for item in experiment.elements if isinstance(item, Laser)]
    screen = next((item for item in experiment.elements if item.id == goal.screenId and isinstance(item, Screen)), None)
    if len(lenses) != 1 or lenses[0].id != goal.lensId or len(sources) != 1 or screen is None:
        raise ValueError("自动设计目前支持一个光源、一片透镜及指定观察屏。请先加载单透镜聚焦装置。")
    if goal.positionRange.start <= sources[0].positionMm:
        raise ValueError("整个透镜位置范围必须在光源之后。")
    lens = lenses[0]
    rows, grids = [], []

    def evaluate(position, focal, phase):
        row = {"positionMm": position, "focalLengthMm": focal, "phase": phase,
               "radiusMm": None, "capturedFraction": None, "quality": None, "warnings": [], "error": None}
        try:
            result = simulate(candidate_experiment(experiment, goal, position, focal))
            row.update(metrics(result, goal.screenId))
        except (ValueError, OverflowError, ZeroDivisionError):
            row["error"] = "此参数组合存在位置重合或超出计算范围。"
        return row

    baseline = evaluate(lens.positionMm, lens.focalLengthMm, "baseline")

    def grid(position_range, focal_range, phase):
        positions, focals = axis(position_range), axis(focal_range)
        grids.append({"phase": phase, "positionsMm": positions, "focalsMm": focals})
        rows.extend(evaluate(position, focal, phase) for focal in focals for position in positions)

    grid(goal.positionRange, goal.focalRange, "coarse")

    def usable():
        return [row for row in rows if row["quality"] == "within-model" and row["error"] is None]

    def ranking(row):
        return (row["radiusMm"], row["positionMm"], row["focalLengthMm"])

    candidates = usable()
    if candidates:
        center = min(candidates, key=ranking)
        def local(bounds, value):
            step = (bounds.stop - bounds.start) / (GRID_SIZE - 1)
            return SearchRange(start=max(bounds.start, value - step), stop=min(bounds.stop, value + step))
        grid(local(goal.positionRange, center["positionMm"]), local(goal.focalRange, center["focalLengthMm"]), "refined")

    recommendation = None
    candidates = usable()
    if candidates:
        best = min(candidates, key=ranking)
        final_experiment = candidate_experiment(experiment, goal, best["positionMm"], best["focalLengthMm"])
        # A fresh calculation is required before a candidate is offered for loading.
        verified = simulate(final_experiment)
        verified_metrics = metrics(verified, goal.screenId)
        if verified_metrics["quality"] != "within-model" or verified_metrics["radiusMm"] != best["radiusMm"]:
            raise ValueError("推荐方案未通过重新计算核对，请重试。")
        boundaries = []
        for label, bounds, value in [("透镜位置", goal.positionRange, best["positionMm"]), ("焦距", goal.focalRange, best["focalLengthMm"])]:
            if value in [bounds.start, bounds.stop]:
                boundaries.append(label)
        recommendation = {**best, "experiment": final_experiment.model_dump(), "verified": True,
                          "boundaryParameters": boundaries,
                          "improvementFraction": 1 - best["radiusMm"] / baseline["radiusMm"] if baseline["radiusMm"] and baseline["quality"] == "within-model" else None}
    return {"id": str(uuid4()), "createdAt": datetime.now(timezone.utc).isoformat(),
            "searchVersion": SEARCH_VERSION, "modelVersion": MODEL_VERSION,
            "inputSnapshot": experiment.model_dump(), "goal": goal.model_dump(),
            "objective": "minimize_screen_1e2_radius", "units": {"length": "mm", "radius": "mm"},
            "method": "先在全范围21×21等间距组合中比较，再在较好组合附近21×21细化；仅推荐没有模型警告的已计算点。",
            "limitations": ["有限网格与一次局部细化，不保证连续范围内或全局最优。", "光束半径按1/e²光强定义；空气、理想薄透镜、M²=1近轴高斯模型。", "未模拟像差、截光后的衍射或真实实验误差，不能替代实验验证。"],
            "baseline": baseline, "grids": grids, "rows": rows,
            "counts": {"total": len(rows), "withinModel": len(candidates),
                       "referenceOnly": sum(row["quality"] == "reference-only" for row in rows),
                       "invalid": sum(row["error"] is not None for row in rows)},
            "recommendation": recommendation,
            "noRecommendationReason": None if recommendation else "没有找到符合当前模型检查条件的方案。请检查口径、光源参数或调整搜索范围。"}


def agent_design_summary(design):
    """The model receives evidence and bounds, not hundreds of redundant grid rows."""
    return {key: design[key] for key in ["id", "goal", "method", "modelVersion", "limitations", "baseline", "counts", "recommendation", "noRecommendationReason"]}
