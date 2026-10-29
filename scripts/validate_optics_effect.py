"""Reproducible numerical validation; no AI calls or student-effect claims.

Run from repository root: python -X utf8 scripts/validate_optics_effect.py
Reference uses 50-digit Decimal arithmetic and a beam-width quadratic, not
the project's complex-q functions. All cases and tolerances are fixed up front.
"""
import csv
import html
import json
import math
import subprocess
import sys
from datetime import datetime
from decimal import Decimal as D, getcontext
from pathlib import Path
from zoneinfo import ZoneInfo
from contextlib import nullcontext

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app import run_simulation, scene_calculation
from backend.models import SimulationRequest
from backend.scene_physics import SceneRequest

getcontext().prec = 50
PI = D('3.1415926535897932384626433832795028841971693993751')
OUT = ROOT / 'output' / 'validation' / 'optics-accuracy-2026-10-08'
OUT.mkdir(parents=True, exist_ok=True)
ATOL, RTOL = 1e-9, 1e-9
cases = []
free = [
    (532, .2, 30, 350), (380, .01, 0, 600), (1100, .01, 0, 600),
    (532, 20, 0, 600), (633, .1, 30, 31), (405, .05, 0, 10),
    (1064, .5, 100, 500), (532, .2, 0, 1), (532, .2, 0, 600),
    (500, .1, 500, 600),
]
for i, (wl, w, z0, z) in enumerate(free, 1):
    cases.append(dict(id=f'G{i:02}', kind='free', experiment=dict(schemaVersion=1,
        name=f'自由传播核对{i}', railLengthMm=600, elements=[
            dict(id='source', kind='laser', name='光源', positionMm=z0, wavelengthNm=wl, waistMm=w),
            dict(id='screen', kind='screen', name='观察屏', positionMm=z, sizeMm=40)])))
focus = [
    (532, .5, 0, 100, 200, 320), (500, 1, 0, 100, 100, 200),
    (380, .02, 0, 50, 100, 150), (1100, .2, 0, 200, 100, 500),
    (532, .01, 0, 200, 20, 100), (633, .1, 0, 100, 200, 50),
    (532, .5, 300, 100, 200, 400), (1064, .2, -100, 5000, 600, 2000),
    (532, .3, 0, 100, 200, 200), (532, 5, 0, 10, 100, 110),
]
for i, values in enumerate(focus, 1):
    cases.append(dict(id=f'F{i:02}', kind='focus', parameters=dict(zip(
        ['wavelengthNm', 'waistMm', 'waistPositionMm', 'focalLengthMm', 'lensPositionMm', 'observationMm'], values))))


def reference(case):
    if case['kind'] == 'free':
        s, screen = case['experiment']['elements']
        wl, w, distance = D(str(s['wavelengthNm'])) / 1000000, D(str(s['waistMm'])), D(str(screen['positionMm'])) - D(str(s['positionMm']))
        variance = w*w + (distance*wl/(PI*w))**2
        zr = PI*w*w/wl
        return dict(radiusMm=variance.sqrt(), rayleighMm=zr,
                    divergenceMrad=wl/(PI*w)*1000, wavefrontRadiusMm=distance+zr*zr/distance,
                    peakRelativeToWaist=w*w/variance), False
    p = {k: D(str(v)) for k, v in case['parameters'].items()}
    wl, w, f = p['wavelengthNm']/1000000, p['waistMm'], p['focalLengthMm']
    d, t = p['lensPositionMm']-p['waistPositionMm'], p['observationMm']-p['lensPositionMm']
    # w(t)^2 = w0^2*(1-t/f)^2 + theta0^2*(d+t*(1-d/f))^2.
    # Minimize this quadratic independently of complex q propagation.
    alpha, beta = w*w, (wl/(PI*w))**2
    c0 = alpha + beta*d*d
    c1 = -2*alpha/f + 2*beta*d*(1-d/f)
    c2 = alpha/(f*f) + beta*(1-d/f)**2
    t_min = -c1/(2*c2)
    waist2 = c0-c1*c1/(4*c2)
    radius2 = alpha+beta*(p['observationMm']-p['waistPositionMm'])**2 if t < 0 else c0+c1*t+c2*t*t
    output = dict(observationRadiusMm=radius2.sqrt(), outputWaistMm=waist2.sqrt(),
        outputWaistPositionMm=p['lensPositionMm']+t_min, outputRayleighMm=PI*waist2/wl,
        lensRadiusMm=c0.sqrt(), minimumForwardMm=c0.sqrt() if t_min < D('-1e-8') else waist2.sqrt())
    warning = max(wl/(PI*w), wl/(PI*waist2.sqrt())) >= D('.1')
    return output, warning


def dump(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


dump('cases.json', cases)
subprocess.run(['node', '--import', 'tsx', str(ROOT/'scripts/validate-optics-effect.ts'), str(OUT/'cases.json'), str(OUT/'frontend-results.json')], cwd=ROOT, check=True)
front = {v['id']: v for v in json.loads((OUT/'frontend-results.json').read_text(encoding='utf-8'))}
rows, raw, case_results = [], [], []
with nullcontext():
    for case in cases:
        expected, expected_warning = reference(case)
        if case['kind'] == 'free':
            body = run_simulation(SimulationRequest.model_validate(dict(revision=1, experiment=case['experiment'])))
        else:
            body = scene_calculation(SceneRequest.model_validate(dict(state=dict(sceneId='gaussian-focus', parameters=case['parameters']), revision=case['id'])))
        raw.append(dict(id=case['id'], invocation='validated-request-direct-route-call', response=body))
        result = body
        if case['kind'] == 'free':
            # Supplement /api/simulate with the actual assistant-context function.
            from backend.gaussian import gaussian_summary
            g = gaussian_summary(result)['gaussian']
            actual = {k: g[k] for k in expected}
        else:
            actual = {m['key']: m['value'] for m in result['metrics']}
        passed = True
        for implementation, readings in [('网页计算', front[case['id']]['metrics']), ('后台计算', actual)]:
            for key, value in expected.items():
                target, observed = float(value), readings[key]
                error = abs(observed-target)
                relative = error/abs(target) if target else None
                ok = math.isfinite(observed) and error <= ATOL+RTOL*abs(target)
                passed &= ok
                rows.append(dict(case=case['id'], implementation=implementation, metric=key,
                    expected=target, actual=observed, absolute_error=error, relative_error=relative, passed=ok))
        warning_ok = True
        if case['kind'] == 'focus':
            warning_ok = bool(result['warnings']) == expected_warning and front[case['id']]['warning'] == expected_warning
            passed &= warning_ok
        case_results.append(dict(id=case['id'], passed=passed, expected_warning=expected_warning, warning_check=warning_ok))

dump('backend-results.json', raw)
dump('comparisons.json', rows)
with (OUT/'逐项核对.csv').open('w', encoding='utf-8-sig', newline='') as stream:
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
summary = dict(date=datetime.now(ZoneInfo('America/Los_Angeles')).isoformat(),
    total_cases=len(cases), passed_cases=sum(c['passed'] for c in case_results),
    numeric_checks=len(rows), passed_numeric_checks=sum(r['passed'] for r in rows),
    max_relative_error=max(r['relative_error'] or 0 for r in rows),
    max_absolute_error=max(r['absolute_error'] for r in rows),
    absolute_tolerance=ATOL, relative_tolerance=RTOL, cases=case_results,
    scope='理想高斯光束自由传播与单薄透镜聚焦；验证网页计算函数与后台请求校验及计算入口，不验证HTTP网络传输，不调用大模型，不操作浏览器，不验证真实实验或教学效果。')
dump('summary.json', summary)
table = ''.join('<tr>'+''.join(f'<td>{html.escape(str(r[k]))}</td>' for k in ['case','implementation','metric','expected','actual','absolute_error','passed'])+'</tr>' for r in rows)
report = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>光学智研计算准确性验证</title>
<style>body{{font:16px/1.7 system-ui;max-width:1150px;margin:40px auto;padding:0 24px;color:#163047}}h1{{font-size:28px}}strong{{color:#087666}}table{{border-collapse:collapse;width:100%;font-size:12px}}td,th{{padding:7px;border-bottom:1px solid #dde5eb;text-align:left}}code{{background:#eef3f7}}details{{margin-top:24px}}a{{color:#1268a0}}</style>
<h1>光学智研：第一轮计算准确性验证</h1><p>执行时间：{html.escape(summary['date'])}。执行者：项目开发环境自动核对，非第三方检测。</p>
<p><strong>{summary['passed_cases']}/{len(cases)} 组通过，{summary['passed_numeric_checks']}/{len(rows)} 项数值核对通过。</strong></p>
<p>覆盖 10 组自由传播、10 组单透镜聚焦，同时核对实际网页数值函数和后台请求校验及计算入口。最大相对偏差 {summary['max_relative_error']:.3e}，即 {summary['max_relative_error']*100:.3e}%。</p>
<h2>验证方法</h2><p>参数和判据在执行前固定，全部样例和失败均保留。独立参考程序使用50位十进制运算；参考计算不调用网站的光束计算函数。绝对误差须不超过 10⁻⁹ + 10⁻⁹×|参考值|（各指标按自身单位）。</p>
<p>自由传播使用 w²=w₀²+[λ(z−z₀)/(πw₀)]²。聚焦采用独立的光束宽度二次式：w²(t)=w₀²(1−t/f)²+[λ/(πw₀)]²[d+t(1−d/f)]²，并通过二次式极值求束腰位置和大小。d为入射束腰到透镜的有向距离，t为透镜到观察面的距离，全部长度为毫米。观察面在透镜前时使用入射光束公式。</p>
<p>公式依据：<a href="https://www.edmundoptics.com/knowledge-center/application-notes/lasers/gaussian-beam-propagation/">Edmund Optics 高斯传播说明（式2—6、11—13）</a>；<a href="https://www.rp-photonics.com/abcd_matrix.html">RP Photonics 光学传输矩阵</a>。以上二次式由传输矩阵展开推得，独立实现并不意味着独立物理模型。</p>
<h2>覆盖范围与边界</h2><p>覆盖380—1100 nm、不同束腰和传播距离、短与长焦距、观察面在透镜前/透镜处/透镜后、入射束腰在透镜之后的会聚光束、延拓束腰，以及大角度模型警告。F10为超出小角度可靠范围的警告样例；公式一致不代表该样例在真实物理上准确。其余样例也仅在理想模型假设下成立。</p>
<p>测试环境的HTTP测试客户端未及时返回，已中止该次执行；本报告改用与接口相同的请求校验模型及实际计算入口，不把网络接口连通性计为通过。未检测大模型回答质量、网页点击与绘图、三维搭建完整链路、真实器件像差和实测数据、用户效率或学习成绩。本轮只能作为“所测范围内计算正确性”的证据，不代表全站准确率或教学效果。</p>
<h2>可复查材料</h2><p><a href="逐项核对.csv">逐项核对表</a> · <a href="cases.json">20组完整输入</a> · <a href="frontend-results.json">网页原始输出</a> · <a href="backend-results.json">后台原始输出</a> · <a href="summary.json">汇总数据</a></p>
<p>复跑：在项目根目录执行 <code>python -X utf8 scripts/validate_optics_effect.py</code>。固定测试集不使用随机抽样。结果属于开发者自测。</p>
<details><summary>查看全部{len(rows)}项核对结果</summary><table><tr><th>样例</th><th>计算端</th><th>指标</th><th>参考值</th><th>网站值</th><th>绝对偏差</th><th>通过</th></tr>{table}</table></details></html>'''
(OUT/'验证报告.html').write_text(report, encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if k!='cases'}, ensure_ascii=False, indent=2))
if summary['passed_cases'] != len(cases):
    print(json.dumps([c for c in case_results if not c['passed']], ensure_ascii=False, indent=2))
    raise SystemExit(1)
