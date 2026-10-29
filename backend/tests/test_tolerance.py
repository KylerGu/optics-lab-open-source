import copy
import json
import math
import unittest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import app
from backend.agent import Workspace
from backend.models import Experiment
from backend.optics import simulate
from backend.tolerance import Tolerance, run_tolerance, verified_study_answer
from backend.tests import test_agent as agent_tests
from backend.tests.test_agent import experiment, answer, call
from backend.tests.test_research import goal


def tolerance(**changes):
    return Tolerance.model_validate({"lensId":"lens", "screenId":"screen", "positionErrorMm":1, "focalErrorPercent":1, **changes})


def radius(position, focal, screen, wavelength=0.0005, waist=1, source=0):
    # Independent waist-plane ABCD relation, including the source-to-lens distance.
    s, d = position-source, screen-position
    a, b = 1-d/focal, s+d-s*d/focal
    return math.hypot(a*waist, b*wavelength/math.pi/waist)


class ToleranceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = experiment()
        cls.study = run_tolerance(cls.original, tolerance())
        cls.robust = run_tolerance(cls.original, tolerance(), goal())

    def test_joint_error_grid_matches_independent_formula_and_units(self):
        baseline=self.study["baseline"]
        self.assertEqual(baseline["counts"]["total"],81)
        for row in baseline["rows"]:
            self.assertEqual(row["positionMm"],100+row["positionErrorMm"])
            self.assertEqual(row["focalLengthMm"],100*(1+row["focalErrorPercent"]/100))
            self.assertAlmostEqual(row["radiusMm"],radius(row["positionMm"],row["focalLengthMm"],200),places=12)
        self.assertEqual(baseline["maxRadiusMm"],max(row["radiusMm"] for row in baseline["rows"]))
        axis_only=max(row["radiusMm"] for row in baseline["rows"] if row["positionErrorMm"]==0 or row["focalErrorPercent"]==0)
        self.assertGreater(baseline["maxRadiusMm"],axis_only)

    def test_single_error_has_nine_points_and_other_parameter_is_fixed(self):
        study=run_tolerance(experiment(),tolerance(focalErrorPercent=0))
        self.assertEqual(study["baseline"]["counts"]["total"],9)
        self.assertTrue(all(row["focalLengthMm"]==100 for row in study["baseline"]["rows"]))
        study=run_tolerance(experiment(),tolerance(positionErrorMm=0))
        self.assertEqual(study["baseline"]["counts"]["total"],9)
        self.assertTrue(all(row["positionMm"]==100 for row in study["baseline"]["rows"]))

    def test_all_candidate_maxima_match_independent_formula_and_recommendation_is_minimax(self):
        study=self.robust
        self.assertEqual(study["counts"],{"nominalCases":882,"scenarioCases":71442,"eligibleCases":882})
        for row in study["candidates"]:
            expected=max(radius(row["positionMm"]+dp,row["focalLengthMm"]*(1+df/100),350)
                         for dp in study["baseline"]["positionOffsetsMm"] for df in study["baseline"]["focalOffsetsPercent"])
            self.assertAlmostEqual(row["maxRadiusMm"],expected,places=12)
        self.assertEqual(study["recommendation"]["maxRadiusMm"],min(row["maxRadiusMm"] for row in study["candidates"]))
        self.assertEqual(study["nominalBest"]["nominal"]["radiusMm"],min(row["nominal"]["radiusMm"] for row in study["candidates"]))
        document=Experiment.model_validate(study["recommendation"]["experiment"])
        self.assertTrue(study["recommendation"]["verified"])
        self.assertEqual(simulate(document)["screens"][0]["radiusMm"],study["recommendation"]["nominal"]["radiusMm"])
        self.assertLess(study["recommendation"]["maxRadiusMm"],study["nominalBest"]["maxRadiusMm"])
        rec=study["recommendation"]
        self.assertEqual(rec["maxRadiusDifferenceMm"],study["baseline"]["maxRadiusMm"]-rec["maxRadiusMm"])
        self.assertEqual(rec["maxRadiusImprovementPercent"],rec["maxRadiusImprovement"]*100)

    def test_input_is_unchanged_and_error_ranges_are_not_clipped_at_nominal_bounds(self):
        original=copy.deepcopy(self.original.model_dump())
        self.assertEqual(self.original.model_dump(),original)
        self.assertEqual(self.robust["inputSnapshot"],original)
        best=self.robust["nominalBest"]
        self.assertTrue(any(row["focalLengthMm"]<80 for row in best["rows"]))
        self.assertTrue(any(row["focalLengthMm"]>80 for row in best["rows"]))
        json.dumps(self.robust,allow_nan=False)

    def test_invalid_deviations_are_counted_and_never_treated_as_stable(self):
        document=experiment().model_dump()
        document["elements"][1]["positionMm"]=199
        study=run_tolerance(Experiment.model_validate(document),tolerance(positionErrorMm=5))
        self.assertEqual(study["baseline"]["counts"]["invalid"],36)
        self.assertFalse(study["baseline"]["eligible"])
        self.assertTrue(all(row["radiusMm"] is None for row in study["baseline"]["rows"] if row["positionMm"]>=200))

    def test_model_warnings_exclude_every_candidate_from_recommendation(self):
        document=experiment().model_dump()
        document["elements"][0]["waistMm"]=10
        document["elements"][1]["diameterMm"]=1
        study=run_tolerance(Experiment.model_validate(document),tolerance(),goal())
        self.assertEqual(study["counts"]["nominalCases"],441)
        self.assertEqual(study["counts"]["eligibleCases"],0)
        self.assertIsNone(study["recommendation"])
        self.assertTrue(study["noRecommendationReason"])

    def test_summary_calculation_preserves_physics_metrics_and_model_warnings(self):
        for waist,diameter,focal in [(1,25.4,100),(10,1,100),(20,100,80)]:
            document=experiment().model_dump()
            document["elements"][0]["waistMm"]=waist
            document["elements"][1].update(diameterMm=diameter,focalLengthMm=focal)
            document=Experiment.model_validate(document)
            full,compact=simulate(document),simulate(document,include_display=False)
            for key in ["modelVersion","quality","warnings","minimum","apertureChecks","endMatrix","assumptions"]:
                self.assertEqual(full[key],compact[key])
            for first,second in zip(full["screens"],compact["screens"]):
                self.assertEqual({key:value for key,value in first.items() if key!="profile"},{key:value for key,value in second.items() if key!="profile"})
            self.assertEqual(compact["samples"],[])

    def test_bounds_unknown_devices_and_unresolvable_error_are_rejected(self):
        for change in [{"positionErrorMm":-1},{"focalErrorPercent":21},{"focalErrorPercent":float("inf")},{"positionErrorMm":0,"focalErrorPercent":0},{"samples":100000}]:
            with self.assertRaises(ValidationError):tolerance(**change)
        for change in [{"lensId":"missing"},{"screenId":"lens"},{"positionErrorMm":1e-15,"focalErrorPercent":0}]:
            with self.assertRaises(ValueError):run_tolerance(experiment(),tolerance(**change))

    def test_api_echoes_settings_and_rejects_ambiguous_modes(self):
        client=TestClient(app)
        payload={"requestId":"tolerance-request","experiment":experiment().model_dump(),"tolerance":tolerance().model_dump(),"mode":"analysis","goal":None}
        response=client.post('/api/research/tolerance',json=payload)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()["requestId"],payload["requestId"])
        self.assertEqual(response.json()["study"]["tolerance"],payload["tolerance"])
        payload["goal"]=goal().model_dump()
        self.assertEqual(client.post('/api/research/tolerance',json=payload).status_code,422)
        payload.update(mode="robust-search",goal=None)
        self.assertEqual(client.post('/api/research/tolerance',json=payload).status_code,422)


class ToleranceAgentTests(unittest.TestCase):
    def test_real_analysis_tool_is_read_only_and_model_receives_compact_evidence(self):
        observed=[]
        result=agent_tests.AgentLoopTests().execute([answer(calls=[call('analyze_tolerance',{'tolerance':tolerance().model_dump()})]),answer('最大半径99 mm、增大1000%，这个错误数字不能展示。')],observer=observed.append)
        self.assertFalse(result['changed'])
        self.assertEqual(result['studies'][0]['baseline']['counts']['total'],81)
        data=json.loads(observed[-1]['messages'][-1]['content'])['data']
        self.assertNotIn('rows',data['baseline'])
        self.assertEqual(data['baseline']['maxRadiusMm'],result['studies'][0]['baseline']['maxRadiusMm'])
        self.assertEqual(result['answer'],verified_study_answer(result['studies'][0]))
        self.assertNotIn('1000%',result['answer'])

    def test_record_bounds_and_apply_verification(self):
        workspace=Workspace(experiment())
        workspace.execute('analyze_tolerance',{'tolerance':tolerance().model_dump()})
        data,_=workspace.execute('search_robust_focus',{'tolerance':tolerance().model_dump(),'goal':goal().model_dump()})
        self.assertEqual(workspace.experiment,experiment())
        workspace.execute('apply_robust_focus',{'studyId':data['id']})
        self.assertEqual(workspace.evidence_key,workspace.key())
        self.assertEqual(workspace.evidence['screens'][0]['radiusMm'],data['recommendation']['nominal']['radiusMm'])
        with self.assertRaises(ValueError):workspace.execute('analyze_tolerance',{'tolerance':tolerance().model_dump()})
        with self.assertRaises(ValueError):workspace.execute('apply_robust_focus',{'studyId':data['id']})


if __name__=='__main__':unittest.main()
