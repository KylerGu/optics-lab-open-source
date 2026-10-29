"""Same-model paired benchmark. Real API calls; no mock answers or LLM judge.

python -X utf8 scripts/validate_ai_effect.py --limit 2
python -X utf8 scripts/validate_ai_effect.py
Existing attempts, including errors, are retained and never silently retried.
"""
import argparse
import csv
import html
import json
import math
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.settings import get_settings
from backend.agent import completion, AgentError
from backend.scene_agent import SceneAgentRequest, run_scene_agent
from backend.scene_physics import SceneState, DEFINITIONS, FORMULAS

OUT = ROOT/'output'/'validation'/'ai-comparison-2026-10-08'
OUT.mkdir(parents=True, exist_ok=True)
REPEATS, ATOL, RTOL = 2, 1e-6, .005


def focus_reference(p):
    w, wavelength, f = p['waistMm'], p['wavelengthNm']*1e-6, p['focalLengthMm']
    d, t = p['lensPositionMm']-p['waistPositionMm'], p['observationMm']-p['lensPositionMm']
    a, b = w*w, (wavelength/(math.pi*w))**2
    c0, c1, c2 = a+b*d*d, -2*a/f+2*b*d*(1-d/f), a/f**2+b*(1-d/f)**2
    pos = -c1/(2*c2)
    # Use determinant identity for numerical stability, independent of q code.
    waist2 = a*b/c2
    observation = math.sqrt(a+b*(p['observationMm']-p['waistPositionMm'])**2) if t < 0 else math.hypot(w*(1-t/f), math.sqrt(b)*(d+t*(1-d/f)))
    return dict(radius_mm=observation, waist_mm=math.sqrt(waist2), waist_position_mm=p['lensPositionMm']+pos,
                real_forward_waist=pos >= -1e-8, paraxial_valid=max(math.sqrt(b),wavelength/(math.pi*math.sqrt(waist2)))<.1)


tasks=[]
def add(id, scene, patch, title, question, expected):
    p={f['key']:f['default'] for f in DEFINITIONS[scene]['parameters']}
    p.update(patch)
    state=SceneState.model_validate(dict(sceneId=scene, parameters=p)).model_dump()
    schema=', '.join(f'"{k}": {"true或false" if isinstance(v,bool) else "数值"}' for k,v in expected.items())
    message=(f'{question} 请使用当前给定参数，仅计算和解释，不修改场景。数值至少保留6位有效数字。'
             f'最后单独输出一个JSON对象，字段为 {{{schema}}}；字段单位以名称或题目为准，布尔值表示判断。')
    tasks.append(dict(id=id, title=title,state=state,message=message,expected=expected))


for id,title,patch,keys,question in [
    ('T01','单透镜常规聚焦',{},['radius_mm','waist_mm'],'求观察面光斑半径radius_mm与出射束腰半径waist_mm，单位mm。'),
    ('T02','虚束腰与实际传播',dict(waistMm=.01,focalLengthMm=200,lensPositionMm=20,observationMm=100),['waist_position_mm','real_forward_waist'],'求出射光束延拓束腰的绝对位置waist_position_mm(mm)，并判断该束腰是否实际位于透镜后方(real_forward_waist)。'),
    ('T03','观察面位于透镜之前',dict(wavelengthNm=633,waistMm=.1,lensPositionMm=200,observationMm=50),['radius_mm'],'观察面在透镜前。求此处入射光束半径radius_mm(mm)。'),
    ('T10','小角度模型适用边界',dict(waistMm=5,focalLengthMm=10,lensPositionMm=100,observationMm=110),['radius_mm','paraxial_valid'],'求理想公式给出的观察面半径radius_mm(mm)。以入射和出射发散半角均小于0.1 rad为判据，判断小角度模型可靠性paraxial_valid；公式有结果不代表物理近似可靠。'),
]:
    p={f['key']:f['default'] for f in DEFINITIONS['gaussian-focus']['parameters']};p.update(patch)
    ref=focus_reference(p)
    add(id,'gaussian-focus',patch,title,question,{k:ref[k] for k in keys})

wl,a,L,y=532e-6,.05,500,7
r=wl/a
beta=math.pi*a*y/math.hypot(L,y)/wl
add('T04','diffraction-0',dict(observationMm=y),'单缝远场衍射','求中央亮纹完整宽度width_mm(mm)与观察点相对光强intensity；采用sinθ=y/√(L²+y²)，不要把近轴近似写成精确值。',dict(width_mm=2*L*r/math.sqrt(1-r*r),intensity=(math.sin(beta)/beta)**2))
add('T05','polarization-0',dict(powerMw=17.3,inputAngleDeg=173,axisAngleDeg=11),'偏振轴角度等价','求两条无向轴的较小夹角angle_deg(度)与透射功率power_mw(mW)。',dict(angle_deg=18,power_mw=17.3*math.cos(math.radians(18))**2))
add('T06','polarization-0',dict(powerMw=5,inputAngleDeg=0,axisAngleDeg=45),'不可达目标','只改变偏振片透光轴，能否让透射功率达到8 mW？返回reachable，并给出最大透射功率max_power_mw(mW)。保持输入功率不变。',dict(reachable=False,max_power_mw=5))
w,wf,offset,theta,wl=4,5.2,1.5,math.radians(1),1.55
eta=(2*w*wf/(w*w+wf*wf))**2*math.exp(-(2*offset**2+(2*math.pi/wl*math.sin(theta))**2*w*w*wf*wf/2)/(w*w+wf*wf))
add('T07','fiber-modes-1',dict(powerMw=2.4),'光纤尺寸偏移倾角耦合','求理想高斯重叠耦合效率efficiency_pct(百分数，非小数比例)与耦合功率power_mw(mW)。',dict(efficiency_pct=eta*100,power_mw=eta*2.4))
add('T08','radiometric-quantities-0',dict(intensityCd=137,distanceM=3.7),'点光源正算与反算','求当前中心照度illuminance_lx(lx)，以及固定光强时达到80 lx所需距离target_distance_m(m)；只回答所需距离，不应用。',dict(illuminance_lx=137/3.7**2,target_distance_m=math.sqrt(137/80)))
add('T09','wave-fields-1',dict(amplitude1=1.2,amplitude2=.7,phaseDeg=137),'不等振幅相干叠加','求当前平均相对光强intensity；保持两束振幅，仅改变相位时是否可完全消光can_cancel，并给出可达最小相对光强minimum_intensity。',dict(intensity=1.2**2+.7**2+2*1.2*.7*math.cos(math.radians(137)),can_cancel=False,minimum_intensity=.25))
tasks.sort(key=lambda t:t['id'])


def write(name,data):
    target=OUT/name
    tmp=target.with_suffix(target.suffix+'.tmp')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    tmp.replace(target)


class MeteredClient:
    def __init__(self):
        self.client=httpx.Client(follow_redirects=False)
        self.calls=[]
    def post(self,*args,**kwargs):
        started=time.monotonic()
        try:
            response=self.client.post(*args,**kwargs)
        except httpx.HTTPError as error:
            self.calls.append(dict(seconds=time.monotonic()-started,error=type(error).__name__))
            raise
        usage={}
        if response.status_code==200:
            usage=response.json().get('usage',{})
        self.calls.append(dict(seconds=time.monotonic()-started,status=response.status_code,usage=usage))
        return response
    def close(self):self.client.close()


def extract(answer,keys):
    decoder=json.JSONDecoder()
    found=[]
    for match in re.finditer(r'\{',answer):
        try:
            value,_=decoder.raw_decode(answer[match.start():])
            if isinstance(value,dict) and set(keys).issubset(value):found.append(value)
        except ValueError:pass
    return found[-1] if found else None


def score(task,result):
    parsed=extract(result.get('answer',''),task['expected'])
    items={}
    for key,expected in task['expected'].items():
        actual=parsed.get(key) if parsed else None
        if isinstance(expected,bool):ok=isinstance(actual,bool) and actual==expected
        else:ok=not isinstance(actual,bool) and isinstance(actual,(int,float)) and math.isfinite(actual) and abs(actual-expected)<=ATOL+RTOL*abs(expected)
        items[key]=dict(expected=expected,actual=actual,passed=ok)
    complete=parsed is not None and not result.get('error')
    return dict(format_complete=complete,correct=complete and all(i['passed'] for i in items.values()) and not result.get('changed',False),items=items)


def execute(task,repeat,arm,settings,recovery=False):
    result=dict(task_id=task['id'],repeat=repeat,arm=arm,recovery=recovery,started_at=datetime.now(ZoneInfo('America/Los_Angeles')).isoformat())
    started=time.monotonic();client=MeteredClient()
    try:
        if arm=='ordinary':
            definition=DEFINITIONS[task['state']['sceneId']]
            knowledge=[f for f in FORMULAS if f['id'] in definition['formulas']]
            messages=[dict(role='system',content='你是光学助教。根据给定参数和模型范围认真计算，遵循用户的输出要求。你没有外部计算或检索工具。\n场景定义与单位：'+json.dumps(definition,ensure_ascii=False)+'\n共同公式依据：'+json.dumps(knowledge,ensure_ascii=False)+'\n当前参数：'+json.dumps(task['state'],ensure_ascii=False)),dict(role='user',content=task['message'])]
            answer=completion(client,settings,messages,settings.request_timeout_seconds,[])
            result['answer']=answer.get('content') or ''
            result['trace']=[]
        else:
            reply=run_scene_agent(SceneAgentRequest.model_validate(dict(requestId=f"evaluation-{task['id']}-{repeat}",state=task['state'],message=task['message'],history=[])),settings,client)
            result.update(reply)
        result['error']=None
    except Exception as error:
        # No provider response bodies, credentials, or internal reasoning persisted.
        result['error']=str(error) if isinstance(error,AgentError) else type(error).__name__
    finally:client.close()
    result['seconds']=time.monotonic()-started
    result['model_calls']=client.calls
    result['score']=score(task,result)
    write(f"{'recovery-' if recovery else ''}{task['id']}-r{repeat}-{arm}.json",result)
    print(json.dumps(dict(task=task['id'],repeat=repeat,arm=arm,correct=result['score']['correct'],complete=result['score']['format_complete'],seconds=round(result['seconds'],1),calls=len(client.calls),error=result.get('error')),ensure_ascii=False),flush=True)
    return result


def report(settings):
    results=[json.loads(p.read_text(encoding='utf-8')) for p in sorted(OUT.glob('T*-r*-*.json'))]
    summary={}
    for arm in ['ordinary','platform']:
        group=[r for r in results if r['arm']==arm]
        answered=[r for r in group if not r.get('error') and r.get('answer')]
        complete=[r for r in group if r['score']['format_complete']]
        summary[arm]=dict(attempts=len(group),responses=len(answered),complete=len(complete),correct=sum(r['score']['correct'] for r in group),errors=sum(bool(r.get('error')) for r in group),median_seconds=statistics.median([r['seconds'] for r in group]) if group else None,total_model_calls=sum(len(r['model_calls']) for r in group),successful_tool_steps=sum(sum(s.get('status')=='ok' for s in r.get('trace',[])) for r in group))
    write('summary.json',dict(model=settings.model,repeats=REPEATS,planned_runs=len(tasks)*REPEATS*2,completed_runs=len(results),groups=summary))
    rows=[dict(task=r['task_id'],repeat=r['repeat'],arm=r['arm'],completed=r['score']['format_complete'],correct=r['score']['correct'],seconds=r['seconds'],model_calls=len(r['model_calls']),error=r.get('error') or '') for r in results]
    if rows:
        with (OUT/'对比结果.csv').open('w',encoding='utf-8-sig',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    table=''.join('<tr>'+''.join(f'<td>{html.escape(str(row[k]))}</td>' for k in ['task','repeat','arm','completed','correct','seconds','model_calls','error'])+'</tr>' for row in rows)
    summaries=''.join(f"<tr><td>{'普通 AI 问答' if arm=='ordinary' else '光学智研'}</td><td>{g['correct']}/{g['attempts']}</td><td>{g['complete']}/{g['attempts']}</td><td>{g['errors']}</td><td>{g['median_seconds']:.1f}</td><td>{g['total_model_calls']}</td></tr>" for arm,g in summary.items() if g['attempts'])
    details=''.join(f"<details><summary>{r['task_id']} · 第{r['repeat']}次 · {r['arm']} · {'通过' if r['score']['correct'] else '未通过'}</summary><pre>{html.escape(r.get('answer') or r.get('error') or '')}</pre><pre>{html.escape(json.dumps(r['score'],ensure_ascii=False,indent=2))}</pre><a href='{r['task_id']}-r{r['repeat']}-{r['arm']}.json'>完整结果和计算依据</a></details>" for r in results)
    (OUT/'验证报告.html').write_text(f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>光学智研 AI 同题对比</title><style>body{{font:16px/1.7 system-ui;max-width:1100px;margin:36px auto;padding:0 24px;color:#193248}}h1{{font-size:28px}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{padding:8px;border-bottom:1px solid #dde5eb;text-align:left}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f7fa;padding:16px;font-size:13px}}details{{margin:14px 0}}a{{color:#1666a0}}</style>
<h1>第二轮：普通 AI 与光学智研同题对比</h1><p>已记录 {len(results)}/{len(tasks)*REPEATS*2} 次尝试。模型 {html.escape(settings.model)}，思考设置 {html.escape(settings.reasoning_effort)}。本报告为开发者自测，保留失败、超时和重复运行结果。</p>
<table><tr><th>方式</th><th>正确任务数</th><th>完整提交数</th><th>服务错误数</th><th>响应耗时中位数/秒</th><th>模型请求总次数</th></tr>{summaries}</table>
<h2>公平条件和评分</h2><p>10道预先固定的只读计算与边界判断题，每题每种方式重复2次，共40次。两边使用相同模型、思考设置、场景参数、定义、共同公式资料和用户问题，不提供参考答案。普通AI单次作答、无工具；光学智研运行原有场景助手与工具循环，不修改产品代码。两边系统提示不同，这是产品整体能力比较，不能单独证明某个模块的因果效果。</p>
<p>参考答案由测试脚本中的独立公式生成。逐字段判定数值偏差≤10⁻⁶+0.5%×|参考值|；布尔判断必须完全一致。所有字段正确且未擅自修改场景才算任务正确。完整提交指成功返回所要求的全部JSON字段；格式缺失独立保留以便人工复核，不能直接等同于物理错误。相同题目的两次重复不是不同用户或不同问题样本。</p>
<p>请求按题目与重复轮次交替先后，最多同时运行2个请求。耗时包含模型思考、工具和网络，不能当作学生完成任务的耗时。普通问答为单次模型请求；平台允许原产品的多次工具调用，因而计算预算并不相同。记录每次模型请求数量与服务方返回的用量，保留原默认超时和生成上限。计分对象为最终JSON中要求的字段，未完整审查解释文字中的全部额外主张。</p>
<h2>范围与限制</h2><p>覆盖聚焦、单缝衍射、偏振、光纤耦合、点光源照度与相干叠加。未验证修改装置、自动设计搜索、真实课堂、实物实验或浏览器交互。本次通过直接调用产品助手执行真实远程模型请求，不测试网站HTTP路由。结果仅适用于这些题目和当前模型；若两边均正确，应如实报告没有观察到正确率提升。</p>
<p>环境预检有两次连接失败，发生在收到任何服务方HTTP响应之前；已原样另存为 preflight-network-blocked 文件，说明见 <a href="preflight-notes.json">环境预检记录</a>。它们不计入模型能力分数；联网后正式运行的失败均计入结果，不择优重试。</p>
<p><a href="manifest.json">固定题目、参考答案与评分规则</a> · <a href="对比结果.csv">结果汇总表</a> · <a href="summary.json">汇总数据</a>。复跑命令：python -X utf8 scripts/validate_ai_effect.py；已记录尝试不会自动重跑。</p>
<h2>逐次记录</h2><table><tr><th>题目</th><th>重复</th><th>方式</th><th>完整</th><th>正确</th><th>秒</th><th>请求数</th><th>错误</th></tr>{table}</table><h2>原始回答与评分</h2>{details}</html>''',encoding='utf-8')
    return summary


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int);parser.add_argument('--report-only',action='store_true');parser.add_argument('--recovery',action='store_true');args=parser.parse_args()
    settings=get_settings()
    if not settings.configured:raise SystemExit('AI接口尚未配置，未开始实验。')
    manifest=dict(model=settings.model,reasoning_effort=settings.reasoning_effort,repeats=REPEATS,absolute_tolerance=ATOL,relative_tolerance=RTOL,tasks=tasks)
    path=OUT/'manifest.json'
    if path.exists() and json.loads(path.read_text(encoding='utf-8'))!=manifest:raise SystemExit('题目或配置已变化；请另建实验目录，不能混合结果。')
    if not path.exists():write('manifest.json',manifest)
    jobs=[]
    recovery_pairs=set()
    if args.recovery:
        for path in OUT.glob('T*-r*-*.json'):
            result=json.loads(path.read_text(encoding='utf-8'))
            if result.get('error') and any(c.get('error') in {'ConnectError','RemoteProtocolError'} for c in result['model_calls']):
                recovery_pairs.add((result['task_id'],result['repeat']))
        plan=dict(reason='Network interruption recovery. Repeat BOTH arms exactly once for every pair affected by ConnectError or RemoteProtocolError. Preserve original attempts and report separately. No accuracy-based selection.',pairs=sorted(recovery_pairs))
        write('recovery-plan.json',plan)
    for repeat in range(1,REPEATS+1):
        for i,task in enumerate(tasks):
            if args.recovery and (task['id'],repeat) not in recovery_pairs:continue
            arms=['ordinary','platform'] if (i+repeat)%2 else ['platform','ordinary']
            for arm in arms:
                if not (OUT/f"{'recovery-' if args.recovery else ''}{task['id']}-r{repeat}-{arm}.json").exists():jobs.append((task,repeat,arm))
    if args.limit is not None:jobs=jobs[:args.limit]
    if args.report_only:jobs=[]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(execute,*job,settings,args.recovery) for job in jobs]
        for f in as_completed(futures):
            f.result();report(settings)
    print(json.dumps(report(settings),ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':main()
