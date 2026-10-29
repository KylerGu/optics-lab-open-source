"""Deterministic error grids; sampled maxima are not continuous worst-case bounds."""
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import Field, model_validator

from .models import Experiment, Laser, Lens, Screen, StrictModel
from .optics import MODEL_VERSION, simulate
from .research import FocusGoal, SearchRange, axis, metrics

ANALYSIS_VERSION = "single-lens-error-grid/1.0"
ERROR_GRID_SIZE = 9


class Tolerance(StrictModel):
    lensId: str = Field(min_length=1, max_length=100)
    screenId: str = Field(min_length=1, max_length=100)
    positionErrorMm: float = Field(ge=0, le=20)
    focalErrorPercent: float = Field(ge=0, le=20)

    @model_validator(mode="after")
    def nonzero(self):
        if self.positionErrorMm == 0 and self.focalErrorPercent == 0:
            raise ValueError("至少设置一种非零误差；零表示该参数保持不变。")
        return self


class ToleranceRequest(StrictModel):
    requestId: str = Field(min_length=1, max_length=100)
    experiment: Experiment
    tolerance: Tolerance
    mode: Literal["analysis", "robust-search"] = "analysis"
    goal: FocusGoal | None = None

    @model_validator(mode="after")
    def matching_goal(self):
        if self.mode == "robust-search":
            if self.goal is None or self.goal.lensId != self.tolerance.lensId or self.goal.screenId != self.tolerance.screenId:
                raise ValueError("稳定方案搜索需要一致的透镜、观察屏及参数范围。")
        elif self.goal is not None:
            raise ValueError("当前方案误差分析不改变观察屏位置，也不使用搜索范围。")
        return self


def error_axis(limit):
    return [0.0] if limit == 0 else [-limit + 2 * limit * i / (ERROR_GRID_SIZE - 1) for i in range(ERROR_GRID_SIZE)]


class Evaluator:
    def __init__(self, experiment, tolerance, screen_position):
        self.experiment, self.tolerance, self.screen_position = experiment, tolerance, screen_position
        self.source = next(item for item in experiment.elements if isinstance(item, Laser))
        self.position_offsets = error_axis(tolerance.positionErrorMm)
        self.focal_offsets = error_axis(tolerance.focalErrorPercent)

    def document(self, position, focal):
        document = self.experiment.model_dump()
        for element in document["elements"]:
            if element["id"] == self.tolerance.lensId:
                element.update(positionMm=position, focalLengthMm=focal)
            if element["id"] == self.tolerance.screenId:
                element["positionMm"] = self.screen_position
        return Experiment.model_validate(document)

    def point(self, position, focal, position_error, focal_error):
        row = {"positionMm": position, "focalLengthMm": focal, "positionErrorMm": position_error,
               "focalErrorPercent": focal_error, "radiusMm": None, "capturedFraction": None,
               "quality": None, "warnings": [], "error": None}
        try:
            if not self.source.positionMm < position < self.screen_position or focal < 1:
                raise ValueError("偏差后的透镜必须在光源与目标屏之间，正焦距至少1 mm。")
            document = self.document(position, focal)
            row.update(metrics(simulate(document, include_display=False), self.tolerance.screenId))
        except (ValueError, OverflowError, ZeroDivisionError):
            row["error"] = "偏差后的参数超出范围、透镜越过光源或目标屏，或元件位置重合。"
        return row

    def evaluate(self, position, focal):
        if len(set(position + offset for offset in self.position_offsets)) != len(self.position_offsets) or len(set(focal * (1 + offset / 100) for offset in self.focal_offsets)) != len(self.focal_offsets):
            raise ValueError("误差范围过小，无法区分采样点，请扩大误差或设为零。")
        nominal = self.point(position, focal, 0.0, 0.0)
        rows = [self.point(position + dp, focal * (1 + df / 100), dp, df)
                for df in self.focal_offsets for dp in self.position_offsets]
        finite = [row for row in rows if row["radiusMm"] is not None]
        worst = max(finite, key=lambda row: row["radiusMm"]) if finite else None
        counts = {"total": len(rows), "withinModel": sum(row["quality"] == "within-model" for row in rows),
                  "referenceOnly": sum(row["quality"] == "reference-only" for row in rows),
                  "invalid": sum(row["error"] is not None for row in rows)}
        eligible = nominal["quality"] == "within-model" and counts["withinModel"] == counts["total"]
        return {"positionMm": position, "focalLengthMm": focal, "nominal": nominal,
                "positionOffsetsMm": self.position_offsets, "focalOffsetsPercent": self.focal_offsets,
                "rows": rows, "counts": counts, "eligible": eligible,
                "minRadiusMm": min(row["radiusMm"] for row in finite) if finite else None,
                "maxRadiusMm": worst["radiusMm"] if worst else None,
                "maxRelativeIncrease": worst["radiusMm"] / nominal["radiusMm"] - 1 if worst and nominal["radiusMm"] else None,
                "worstSample": worst}


def evaluation_summary(evaluation):
    return {key: value for key, value in evaluation.items() if key not in {"rows", "positionOffsetsMm", "focalOffsetsPercent"}}


def run_tolerance(experiment: Experiment, tolerance: Tolerance, goal: FocusGoal | None = None):
    lenses = [item for item in experiment.elements if isinstance(item, Lens)]
    sources = [item for item in experiment.elements if isinstance(item, Laser)]
    screen = next((item for item in experiment.elements if item.id == tolerance.screenId and isinstance(item, Screen)), None)
    if len(lenses) != 1 or lenses[0].id != tolerance.lensId or len(sources) != 1 or screen is None or lenses[0].focalLengthMm < 1:
        raise ValueError("误差分析目前支持一个光源、一片正焦距透镜和指定观察屏。请加载单透镜聚焦装置。")
    if goal and (goal.lensId != tolerance.lensId or goal.screenId != tolerance.screenId or goal.positionRange.start <= sources[0].positionMm):
        raise ValueError("搜索元件必须一致，整个标称位置范围须在光源之后。")
    evaluator = Evaluator(experiment, tolerance, goal.screenPositionMm if goal else screen.positionMm)
    lens = lenses[0]
    baseline = evaluator.evaluate(lens.positionMm, lens.focalLengthMm)
    candidates, grids = [], []
    best_evaluation, nominal_evaluation = None, None

    def rank(value):
        return (value["maxRadiusMm"], value["nominal"]["radiusMm"], value["positionMm"], value["focalLengthMm"])

    def nominal_rank(value):
        return (value["nominal"]["radiusMm"], value["maxRadiusMm"], value["positionMm"], value["focalLengthMm"])

    def grid(position_range, focal_range, phase):
        nonlocal best_evaluation, nominal_evaluation
        positions, focals = axis(position_range), axis(focal_range)
        grids.append({"phase": phase, "positionsMm": positions, "focalsMm": focals})
        for focal in focals:
            for position in positions:
                evaluation = evaluator.evaluate(position, focal)
                candidates.append({**evaluation_summary(evaluation), "phase": phase})
                if evaluation["eligible"]:
                    if best_evaluation is None or rank(evaluation) < rank(best_evaluation):
                        best_evaluation = evaluation
                    if nominal_evaluation is None or nominal_rank(evaluation) < nominal_rank(nominal_evaluation):
                        nominal_evaluation = evaluation

    recommendation = None
    if goal:
        grid(goal.positionRange, goal.focalRange, "coarse")
        if best_evaluation:
            def local(bounds, value):
                step = (bounds.stop - bounds.start) / 20
                return SearchRange(start=max(bounds.start, value - step), stop=min(bounds.stop, value + step))
            grid(local(goal.positionRange, best_evaluation["positionMm"]), local(goal.focalRange, best_evaluation["focalLengthMm"]), "refined")
        if best_evaluation:
            # Re-evaluate all deviations and a full nominal calculation before offering load.
            verified = evaluator.evaluate(best_evaluation["positionMm"], best_evaluation["focalLengthMm"])
            document = evaluator.document(verified["positionMm"], verified["focalLengthMm"])
            full = metrics(simulate(document), tolerance.screenId)
            if not verified["eligible"] or verified["maxRadiusMm"] != best_evaluation["maxRadiusMm"] or full["radiusMm"] != verified["nominal"]["radiusMm"]:
                raise ValueError("稳定方案未通过重新计算核对。")
            recommendation = {**verified, "experiment": document.model_dump(), "verified": True,
                              "boundaryParameters": [label for label, bounds, value in [
                                  ("透镜位置", goal.positionRange, verified["positionMm"]),
                                  ("焦距", goal.focalRange, verified["focalLengthMm"])] if value in [bounds.start, bounds.stop]],
                              "maxRadiusImprovement": 1 - verified["maxRadiusMm"] / baseline["maxRadiusMm"] if baseline["eligible"] else None,
                              "maxRadiusImprovementPercent": (1 - verified["maxRadiusMm"] / baseline["maxRadiusMm"]) * 100 if baseline["eligible"] else None,
                              "maxRadiusDifferenceMm": baseline["maxRadiusMm"] - verified["maxRadiusMm"] if baseline["eligible"] else None}
    return {"id": str(uuid4()), "createdAt": datetime.now(timezone.utc).isoformat(),
            "analysisVersion": ANALYSIS_VERSION, "modelVersion": MODEL_VERSION,
            "inputSnapshot": experiment.model_dump(), "tolerance": tolerance.model_dump(),
            "mode": "robust-search" if goal else "analysis", "goal": goal.model_dump() if goal else None,
            "screenPositionMm": evaluator.screen_position,
            "objective": "minimize_sampled_max_screen_radius" if goal else "evaluate_parameter_deviations",
            "method": "位置和焦距偏差各取9个等间距值（含端点和零），零误差仅取零；比较两种偏差同时出现时的所有组合。稳定方案先比较21×21标称组合，再在较好点附近21×21细化。",
            "limitations": ["最大半径仅是已计算误差组合中的最大值，不保证连续误差范围的严格最坏界限或全局最优。",
                            "误差范围由用户设定，不假设发生概率、统计分布或置信水平。",
                            "标称参数受搜索范围约束；实际偏差可越过标称范围，不进行截断或缩小误差。",
                            "仅改变所选透镜的位置和焦距；其他元件、光源参数与目标屏固定。",
                            "空气、理想薄透镜、M²=1近轴高斯模型；1/e²光强半径，未计算像差、截断衍射或真实实验误差。"],
            "baseline": baseline, "grids": grids, "candidates": candidates,
            "counts": {"nominalCases": len(candidates), "scenarioCases": sum(item["counts"]["total"] for item in candidates),
                       "eligibleCases": sum(item["eligible"] for item in candidates)},
            "nominalBest": nominal_evaluation, "recommendation": recommendation,
            "noRecommendationReason": "没有找到在全部已计算误差组合中都满足模型检查的方案，请检查误差范围、口径与装置。" if goal and recommendation is None else None}


def agent_study_summary(study):
    result = {key: study[key] for key in ["id", "mode", "tolerance", "goal", "screenPositionMm", "method", "modelVersion", "limitations", "counts", "noRecommendationReason"]}
    for name in ["baseline", "nominalBest", "recommendation"]:
        result[name] = evaluation_summary(study[name]) if study[name] else None
    return result


def verified_study_answer(study):
    """Critical numbers and arithmetic come from the engine, never a model paraphrase."""
    def number(value):
        return "无法计算" if value is None else f"{value:.8g}"
    tol, baseline = study["tolerance"], study["baseline"]
    lines = [f"计算程序已核对：位置允许偏差±{number(tol['positionErrorMm'])} mm，焦距允许偏差±{number(tol['focalErrorPercent'])}%；目标屏固定在{number(study['screenPositionMm'])} mm。零误差表示该参数保持不变；标称参数就是没有偏差时的设定。"]
    if study["mode"] == "analysis":
        lines.append(f"当前透镜标称位置{number(baseline['positionMm'])} mm、焦距{number(baseline['focalLengthMm'])} mm，共计算{baseline['counts']['total']}个偏差组合。无偏差时屏上半径{number(baseline['nominal']['radiusMm'])} mm；可计算点中的半径范围为{number(baseline['minRadiusMm'])}至{number(baseline['maxRadiusMm'])} mm。")
        if baseline["maxRelativeIncrease"] is not None:
            lines.append(f"相对无偏差时，最大采样半径增大{number(baseline['maxRelativeIncrease'] * 100)}%。")
        worst = baseline["worstSample"]
        if worst:
            lines.append(f"最大采样半径对应位置偏差{number(worst['positionErrorMm'])} mm、焦距偏差{number(worst['focalErrorPercent'])}%；实际透镜位置{number(worst['positionMm'])} mm、实际焦距{number(worst['focalLengthMm'])} mm。")
        if not baseline["eligible"]:
            lines.append(f"其中{baseline['counts']['referenceOnly']}个组合有模型警告，{baseline['counts']['invalid']}个无法计算；统计仅覆盖可计算点，不能代表完整误差范围。")
    elif study["recommendation"]:
        rec = study["recommendation"]
        lines.extend([f"比较了{study['counts']['nominalCases']}个标称候选及{study['counts']['scenarioCases']}个偏差组合；{study['counts']['eligibleCases']}个候选的全部已算偏差组合通过模型检查。",
                      "| 方案 | 标称位置 / mm | 标称焦距 / mm | 无偏差半径 / mm | 最大采样半径 / mm |",
                      "|---|---:|---:|---:|---:|"])
        for label, item in [("当前方案", baseline), ("候选中标称光斑较小", study["nominalBest"]), ("误差下较稳定推荐", rec)]:
            lines.append(f"| {label} | {number(item['positionMm'])} | {number(item['focalLengthMm'])} | {number(item['nominal']['radiusMm'])} | {number(item['maxRadiusMm'])} |")
        if not baseline["eligible"]:
            lines.append(f"当前方案有{baseline['counts']['referenceOnly']}个偏差组合存在模型警告，{baseline['counts']['invalid']}个无法计算；当前方案的极值仅覆盖可计算点，不能代表完整误差范围，因此不计算相对改善百分比。推荐及标称光斑较小的候选，其全部已算组合均通过模型检查。")
        if rec["maxRadiusImprovement"] is not None:
            change = "减小" if rec["maxRadiusImprovement"] >= 0 else "增大"
            lines.append(f"推荐方案相对当前方案的最大采样半径{change}{number(abs(rec['maxRadiusDifferenceMm']))} mm，即{number(abs(rec['maxRadiusImprovementPercent']))}%。比较采用同一个固定屏和相同偏差设置。")
            if 0 <= rec["maxRadiusImprovement"] < 0.01:
                lines.append("本次改善幅度较小，不能据此声称真实实验会有明显改善。")
        if rec["boundaryParameters"]:
            lines.append("、".join(rec["boundaryParameters"]) + "处于标称搜索范围边界。")
    else:
        lines.append(study["noRecommendationReason"])
    lines.append("最大值仅是有限采样点中的最大半径，不是连续误差的严格最坏保证；未假设发生概率。采用理想薄透镜、近轴高斯模型，半径按1/e²光强定义，未做真实实验标定。图表与导出记录可用于核对。")
    blocks = []
    for line in lines:
        if line.startswith("|") and blocks and blocks[-1].startswith("|"):
            blocks[-1] += "\n" + line
        else:
            blocks.append(line)
    return "\n\n".join(blocks)
