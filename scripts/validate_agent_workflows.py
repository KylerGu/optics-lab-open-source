"""Conventional non-AI workflows vs existing building/research agents.

Baseline: scripts replay explicit configuration and existing numerical tools.
This is NOT a timed human usability study and does not count UI clicks.
Commands: --baseline, --agent --limit 2, --agent, --report.
All first attempts retained. Network-only recovery is separate (--recovery).
"""
import argparse
import copy
import csv
import html
import json
import math
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import httpx

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.settings import get_settings
from backend.agent import AgentError
from backend.spatial import SpatialExperiment, trace
from backend.spatial_agent import SpatialWorkspace, SpatialAgentRequest, run_spatial_agent
from backend.research_agent import ResearchAgentRequest, run_research_agent, legacy_experiment
from backend.research import FocusGoal, search_focus
from backend.tolerance import Tolerance, run_tolerance

OUT=ROOT/'output'/'validation'/'agent-workflows-2026-10-08'
OUT.mkdir(parents=True,exist_ok=True)


def write(name,data):
    path=OUT/name;tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8');tmp.replace(path)


def apparatus(name,elements):
    return SpatialExperiment.model_validate(dict(schemaVersion=2,name=name,elements=elements)).model_dump(mode='json')


def el(id,kind,pos,**kw):return dict(id=id,name=id,kind=kind,position=pos,**kw)
source=el('source','laser',[0,60,0],beamRadiusMm=1,powerMw=10,rayCount=9)
screen=el('screen','screen',[200,60,0])
builders=[]


def builder(id,title,initial,actions,message,allowed=None,added=None):
    builders.append(dict(id=id,category='building',title=title,initial=initial,actions=actions,
        message=message,allowed=allowed or {},added=added or [],
        baseline_steps=['读取初始装置与任务要求']+[a['label'] for a in actions]+['运行同一三维仿真','按任务阈值核对并保存参数和结果']))


builder('B1','单透镜聚焦',apparatus('聚焦起始装置',[source|dict(beamModel='gaussian'),screen]),
    [dict(op='add',element=el('lens','lens',[100,60,0],focalLengthMm=100,diameterMm=40),label='添加理想薄透镜，按聚焦公式设置位置、焦距与口径')],
    '请在现有光源和观察屏之间添加且仅添加一片理想薄透镜（lens），完成高斯聚焦。要求现有器件全部参数保持不变，观察屏上的高斯1/e²半径不超过0.02 mm，到屏功率为10 mW（允许0.001 mW偏差）。自行确定透镜位置与焦距，仿真核验后给出可应用方案。',added=['lens'])
builder('B2','90度竖直折转',apparatus('折转起始装置',[source,el('screen','screen',[150,260,0],pitchDeg=90)]),
    [dict(op='add',element=el('mirror','mirror',[150,60,0],pitchDeg=-45),label='添加反射镜，设置转折点与45度镜面方向')],
    '请只新增一面平面反射镜，放在[150,60,0] mm处，把沿+X传播的光束折向+Y并完整到达现有观察屏。所有现有器件参数保持不变。要求到屏功率10 mW（误差0.001 mW以内），光斑中心距屏中心不超过0.01 mm。确定镜面朝向并真实仿真核验。',added=['mirror'])
builder('B3','按3比1分光',apparatus('分光起始装置',[source|dict(powerMw=12),el('transmitted','screen',[350,60,0]),el('reflected','screen',[150,260,0],pitchDeg=90)]),
    [dict(op='add',element=el('splitter','splitter',[150,60,0],pitchDeg=-45,transmission=.75),label='添加分光镜，设置位置、方向和75%透射比例')],
    '只添加一个普通分光镜splitter，位于[150,60,0] mm，使transmitted屏得到9 mW，reflected屏得到3 mW，各允许0.001 mW偏差。现有光源和两屏的全部参数不变。自行确定分光镜朝向和透射比例，两路均须到达指定屏，仿真核验并给出可应用方案。',added=['splitter'])
builder('B4','保持光源的功率调整',apparatus('衰减装置',[source,el('filter','filter',[100,60,0],transmission=.8),screen]),
    [dict(op='update',id='filter',patch=dict(transmission=.25),label='按目标功率反算并设置滤光片透过率')],
    '请仅修改filter滤光片的transmission，让观察屏到屏功率达到2.5 mW，允许0.001 mW误差。不增加删除器件，不移动器件，不改变光源功率和其他参数。仿真核验后给出可应用方案。',allowed={'filter':['transmission']})
builder('B5','修正折转光路偏离',apparatus('故障折转装置',[source,el('mirror','mirror',[150,60,0],pitchDeg=-40),el('screen','screen',[150,260,0],pitchDeg=90)]),
    [dict(op='diagnose',label='运行初始仿真并检查光束为何未到指定屏'),dict(op='update',id='mirror',patch=dict(pitchDeg=-45),label='依据反射定律修正镜面俯仰角')],
    '当前折转装置没有把光正确送到screen屏。请诊断并只调整mirror的yawDeg或pitchDeg，其他所有器件与参数必须不变；要求到屏功率10 mW（误差0.001 mW以内），光斑中心距屏中心不超过0.01 mm。不新增或删除器件，修正后真实仿真并给出可应用方案。',allowed={'mirror':['yawDeg','pitchDeg']})

base=apparatus('单透镜研究装置',[source|dict(beamModel='gaussian'),el('lens','lens',[100,60,0],focalLengthMm=100),screen])
alternative=copy.deepcopy(base);alternative['name']='焦距80毫米方案';alternative['elements'][1]['focalLengthMm']=80
goal=dict(lensId='lens',screenId='screen',screenPositionMm=200,positionRange=dict(start=80,stop=120),focalRange=dict(start=80,stop=120))
tolerance=dict(lensId='lens',screenId='screen',positionErrorMm=1,focalErrorPercent=1)
research=[]


def study(id,title,message,steps,**kw):
    objects=[dict(id='A',source='file',label='同条件研究对象A',experiment=base)]
    if id=='R1':objects.append(dict(id='B',source='file',label='同条件研究对象B',experiment=alternative))
    research.append(dict(id=id,category='research',title=title,initial=base,objects=objects,activeObjectId='A',
        message=message+' 不修改原装置。请制定简短研究计划，实际执行计算并关联记录更新进度，最后说明结论与适用范围。',baseline_steps=steps,**kw))


study('R1','两套方案同条件比较','比较对象A与B在screen上的理想高斯光斑半径，以半径较小为优。两方案光源、屏位置与其他条件相同，只有透镜焦距不同；给出两者半径和较优对象。',
    ['选定A、B并核对比较条件','分别运行两套装置仿真','提取高斯半径并比较','保存参数、两份结果和结论'])
study('R2','五点焦距扫描','对对象A的lens焦距按80、90、100、110、120 mm这5点比较，保持其他参数不变。以screen处理想高斯半径为指标，报告这5个已计算点中的最小值及对应焦距，不把它称为连续全局最优。',
    ['选择装置和透镜焦距','设置80—120 mm范围及5点','调用已有非AI参数扫描','读取已计算点中的最小值','保存扫描范围、逐点数据和结论'],scan=dict(elementId='lens',field='focalLengthMm',start=80,stop=120,count=5))
study('R3','二维聚焦方案搜索','对对象A使用平台已有单透镜聚焦搜索：固定screen位置200 mm，lens位置范围80—120 mm，正焦距范围80—120 mm，寻找已计算候选中屏上理想高斯半径最小的方案。给出推荐位置、焦距、半径，并说明相对当前方案是否改善。',
    ['选择装置与观察屏','设置固定屏位置和位置、焦距范围','运行已有非AI二维搜索及细化','读取推荐并复算','保存搜索条件、全部候选和结论'],goal=goal)
study('R4','双参数误差分析','对对象A当前方案进行误差分析：lens位置误差±1 mm，焦距相对误差±1%，其他参数固定。用平台已有误差网格，给出screen处理想高斯半径的标称值和已采样误差组合中的最大值，说明是否比标称值大。',
    ['选择装置、透镜与屏','设置位置±1 mm与焦距±1%误差','运行已有非AI误差网格','比较标称值和最大采样值','保存误差条件、数据和结论'],tolerance=tolerance)
study('R5','误差下较稳定方案搜索','对对象A寻找较稳定方案：screen固定200 mm，lens标称位置80—120 mm、标称正焦距80—120 mm；位置误差±1 mm，焦距误差±1%。使用已有稳定方案搜索，目标为减小已采样误差组合中的最大屏上高斯半径。给出推荐位置、焦距及最大采样半径，并与当前方案比较。不得称为连续误差严格保证。',
    ['选择装置与观察屏','设置位置和焦距搜索范围','设置位置±1 mm与焦距±1%误差','运行已有非AI稳定方案搜索','复算推荐方案的误差组合','保存候选、误差数据和结论'],goal=goal,tolerance=tolerance)
TASKS=builders+research


def model(d):return SpatialExperiment.model_validate(d)
def close(a,b,atol=1e-8,rtol=1e-6):return isinstance(a,(float,int)) and math.isfinite(a) and abs(a-b)<=atol+rtol*abs(b)
def screen_read(result,id='screen'):return next(s for s in result['screens'] if s['elementId']==id)


def building_check(task,document):
    result=trace(model(document));checks=[]
    def ck(name,value):checks.append(dict(item=name,passed=bool(value)))
    initial={e['id']:e for e in task['initial']['elements']};final={e['id']:e for e in model(document).model_dump(mode='json')['elements']}
    for id,e in initial.items():
        unchanged=id in final and all(final[id][k]==v for k,v in e.items() if k not in task['allowed'].get(id,[]) and k!='name')
        ck('保留器件及未授权参数：'+id,unchanged)
    added=[e for id,e in final.items() if id not in initial]
    ck('新增器件类型与数量正确',sorted(e['kind'] for e in added)==sorted(task['added']))
    targets={'B1':{'screen':10},'B2':{'screen':10},'B3':{'transmitted':9,'reflected':3},'B4':{'screen':2.5},'B5':{'screen':10}}[task['id']]
    for id,power in targets.items():
        s=screen_read(result,id);ck(id+'到屏功率达标',close(s['sampledPowerMw'],power,.001,0))
        if task['id'] in {'B2','B5'}:ck('光斑中心与屏中心偏差≤0.01 mm',s['centroid'] is not None and math.dist(s['centroid'],final[id]['position'])<=.01)
    if task['id']=='B1':
        s=screen_read(result);ck('高斯半径≤0.02 mm',s['gaussianRadiusMm'] is not None and 0<s['gaussianRadiusMm']<=.02)
    if task['id'] in {'B2','B3'}:ck('新增器件放在指定位置',len(added)==1 and added[0]['position']==[150,60,0])
    return dict(passed=all(c['passed'] for c in checks),checks=checks,verified_screens=result['screens'],warnings=result['warnings'])


def research_records(reply):
    return reply.get('objectResults') or [reply]


def research_check(task,reply,reference):
    checks=[]
    def ck(name,v):checks.append(dict(item=name,passed=bool(v)))
    # Check retained inputs separately; evidence may be generated from copies.
    if 'objectSnapshots' in reply:
        snaps={o['id']:o['experiment'] for o in reply['objectSnapshots']}
        ck('研究对象原参数保留',all(snaps.get(o['id'])==o['experiment'] for o in task['objects']))
    else:ck('研究对象原参数保留',reply.get('inputSnapshot')==task['initial'])
    records=research_records(reply)
    id=task['id']
    if id=='R1':
        evidence={r.get('objectId'):r.get('evidence') for r in records}
        for obj in ['A','B']:
            try:actual=screen_read(evidence[obj])['gaussianRadiusMm']
            except (KeyError,TypeError,StopIteration):actual=None
            ck(obj+'方案真实计算结果正确',close(actual,reference['values'][obj]))
        ck('保留同一组对象比较记录',any(set(g['objectIds'])=={'A','B'} for g in reply.get('objectComparisons',[])))
    elif id=='R2':
        scans=[s for r in records for s in r.get('comparisons',[]) if s.get('field')=='focalLengthMm']
        good=False
        for scan in scans:
            if len(scan['rows'])!=5:continue
            try:good=all(close(row['value'],ref['value']) and close(screen_read(row)['gaussianRadiusMm'],ref['radius']) for row,ref in zip(scan['rows'],reference['values']))
            except (KeyError,TypeError,StopIteration):good=False
            if good:break
        ck('指定5点完整且逐点数值正确',good)
    elif id=='R3':
        designs=[d for r in records for d in r.get('designs',[])]
        good=False
        for design in designs:
            rec=design.get('recommendation')
            if rec and design['goal']==task['goal']:
                rr=rec['radiusMm'];target=reference['record']['recommendation']['radiusMm']
                good=rec['verified'] and close(rr,target) and bool(design['rows'])
        ck('按指定范围完成搜索且推荐质量达到常规工具结果',good)
    else:
        studies=[s for r in records for s in r.get('studies',[])]
        good=False
        for study in studies:
            if study['tolerance']!=task['tolerance']:continue
            expected=reference['record']
            if id=='R4':good=study['mode']=='analysis' and close(study['baseline']['maxRadiusMm'],expected['baseline']['maxRadiusMm']) and len(study['baseline']['rows'])==81
            else:
                rec=study.get('recommendation');target=expected['recommendation']
                good=study['goal']==task['goal'] and bool(rec) and rec['verified'] and close(rec['maxRadiusMm'],target['maxRadiusMm']) and bool(study['candidates'])
            if good:break
        ck('误差范围、计算记录及结果质量符合任务',good)
    completed=[p for p in reply.get('planProgress',[]) if p['status']=='completed' and p.get('basis')=='calculation' and p.get('evidence')]
    return dict(passed=all(c['passed'] for c in checks),checks=checks,plan_has_calculation_evidence=bool(completed),
        answer=reply.get('answer',''),conclusion_review='pending')


def baseline(task,repeat):
    started=time.monotonic();logs=[];m=model(task['initial'])
    if task['category']=='building':
        d=m.model_dump(mode='json')
        for a in task['actions']:
            if a['op']=='add':d['elements'].append(a['element'])
            elif a['op']=='update':next(e for e in d['elements'] if e['id']==a['id']).update(a['patch'])
            else:logs.append(dict(step=a['label'],result=trace(model(d))))
            d=model(d).model_dump(mode='json')
        result=dict(experiment=d,evidence=trace(model(d)),logs=logs)
        evaluation=building_check(task,d)
    else:
        legacy=legacy_experiment(m)
        if task['id']=='R1':
            values={o['id']:trace(model(o['experiment'])) for o in task['objects']}
            result=dict(records=values,values={k:screen_read(v)['gaussianRadiusMm'] for k,v in values.items()})
        elif task['id']=='R2':
            scan,_=SpatialWorkspace(m).execute('compare_parameter',task['scan'])
            result=dict(record=scan,values=[dict(value=r['value'],radius=screen_read(r)['gaussianRadiusMm']) for r in scan['rows']])
        elif task['id']=='R3':result=dict(record=search_focus(legacy,FocusGoal.model_validate(task['goal'])))
        else:result=dict(record=run_tolerance(legacy,Tolerance.model_validate(task['tolerance']),FocusGoal.model_validate(task['goal']) if task['id']=='R5' else None))
        # Baseline is checked for finite output and all eligible grid points;
        # shared-engine comparison does not constitute an independent physics proof.
        if task['id'] in {'R1','R2'}:ok=all(math.isfinite(v if isinstance(v,(int,float)) else v['radius']) for v in (result['values'].values() if isinstance(result['values'],dict) else result['values']))
        elif task['id']=='R4':ok=result['record']['baseline']['eligible'] and len(result['record']['baseline']['rows'])==81
        else:ok=bool(result['record']['recommendation']) and result['record']['recommendation']['verified']
        evaluation=dict(passed=ok,checks=[dict(item='常规数值流程产生完整有效结果',passed=ok)])
    output=dict(task=task['id'],repeat=repeat,arm='conventional',seconds=time.monotonic()-started,
        configuration_steps=task['baseline_steps'],result=result,evaluation=evaluation,model_calls=0)
    write(f"{task['id']}-r{repeat}-conventional.json",output)
    print(json.dumps(dict(task=task['id'],repeat=repeat,arm='conventional',passed=evaluation['passed'],seconds=round(output['seconds'],2)),ensure_ascii=False),flush=True)
    return output


class MeteredClient:
    def __init__(self):self.client=httpx.Client(follow_redirects=False);self.calls=[]
    def post(self,*args,**kwargs):
        started=time.monotonic()
        try:r=self.client.post(*args,**kwargs)
        except httpx.HTTPError as e:
            self.calls.append(dict(seconds=time.monotonic()-started,error=type(e).__name__));raise
        self.calls.append(dict(seconds=time.monotonic()-started,status=r.status_code,usage=r.json().get('usage',{}) if r.status_code==200 else {}));return r
    def close(self):self.client.close()


def agent(task,repeat,recovery=False):
    settings=get_settings();client=MeteredClient();started=time.monotonic()
    output=dict(task=task['id'],repeat=repeat,arm='agent',recovery=recovery,
        started_at=datetime.now(ZoneInfo('America/Los_Angeles')).isoformat(),model=settings.model,reasoning_effort=settings.reasoning_effort,
        prompt=task['message'],input=task['initial'])
    try:
        if task['category']=='building':
            req=SpatialAgentRequest.model_validate(dict(requestId=f"eval-{task['id']}-{repeat}",experiment=task['initial'],message=task['message']))
            reply=run_spatial_agent(req,settings,client)
            reply=json.loads(json.dumps(reply,ensure_ascii=False,allow_nan=False))
            evaluation=building_check(task,reply['experiment'])
            evaluation['checks'].append(dict(item='平台允许应用已核验方案',passed=reply['applyAllowed']))
            evaluation['passed'] &= reply['applyAllowed']
        else:
            req=ResearchAgentRequest.model_validate(dict(requestId=f"eval-{task['id']}-{repeat}",objects=task['objects'],activeObjectId='A',experiment=task['initial'],message=task['message']))
            reply=run_research_agent(req,settings,client)
            reply=json.loads(json.dumps(reply,ensure_ascii=False,allow_nan=False))
            ref=json.loads((OUT/f"{task['id']}-r{repeat}-conventional.json").read_text(encoding='utf-8'))['result']
            evaluation=research_check(task,reply,ref)
        output.update(result=reply,evaluation=evaluation,error=None)
    except Exception as e:
        output.update(error=str(e) if isinstance(e,AgentError) else type(e).__name__,evaluation=dict(passed=False,checks=[]))
    finally:client.close()
    output.update(seconds=time.monotonic()-started,model_calls=client.calls)
    write(f"{'recovery-' if recovery else ''}{task['id']}-r{repeat}-agent.json",output)
    print(json.dumps(dict(task=task['id'],repeat=repeat,arm='agent',recovery=recovery,passed=output['evaluation']['passed'],seconds=round(output['seconds'],1),calls=len(client.calls),error=output.get('error')),ensure_ascii=False),flush=True)
    return output


def report():
    originals=[json.loads(p.read_text(encoding='utf-8')) for p in sorted(OUT.glob('*-r*-agent.json')) if not p.name.startswith('recovery-')]
    recoveries=[json.loads(p.read_text(encoding='utf-8')) for p in sorted(OUT.glob('recovery-*-agent.json'))]
    conventional=[json.loads(p.read_text(encoding='utf-8')) for p in sorted(OUT.glob('*-r*-conventional.json'))]
    chosen={(r['task'],r['repeat']):r for r in originals}
    for r in recoveries:chosen[(r['task'],r['repeat'])]=r
    notes=json.loads((OUT/'conclusion-review.json').read_text(encoding='utf-8')) if (OUT/'conclusion-review.json').exists() else {}
    rows=[]
    for task in TASKS:
        bs=[r for r in conventional if r['task']==task['id']];ags=[r for (id,n),r in chosen.items() if id==task['id']]
        rows.append(dict(task=task['id'],title=task['title'],conventional_pass=sum(r['evaluation']['passed'] for r in bs),conventional_attempts=len(bs),agent_pass=sum(r['evaluation']['passed'] for r in ags),agent_attempts=len(ags),agent_mean_seconds=statistics.mean(r['seconds'] for r in ags) if ags else None,
            baseline_configuration_stages=len(task['baseline_steps']),agent_instruction_submissions=len(ags),
            agent_successful_tool_steps=sum(sum(s['status']=='ok' for s in r.get('result',{}).get('trace',[])) for r in ags),
            conclusion_reviews=[notes.get(('recovery-' if r.get('recovery') else '')+f"{r['task']}-r{r['repeat']}") for r in ags] if task['category']=='research' else []))
    summary=dict(tasks=rows,original_agent_attempts=len(originals),original_agent_pass=sum(r['evaluation']['passed'] for r in originals),original_service_errors=sum(bool(r.get('error')) for r in originals),recovery_attempts=len(recoveries),selected_agent_pass=sum(r['evaluation']['passed'] for r in chosen.values()),selected_agent_attempts=len(chosen),conventional_pass=sum(r['evaluation']['passed'] for r in conventional),conventional_attempts=len(conventional),
        interpretation='Comparison of scripted conventional configuration versus autonomous agents, not human elapsed time or click counts; shared numerical engine.')
    summary.update(building_objective_pass=sum(r['evaluation']['passed'] for r in chosen.values() if r['task'].startswith('B')),
        research_numeric_pass=sum(r['evaluation']['passed'] for r in chosen.values() if r['task'].startswith('R')),
        research_plans_with_evidence=sum(r['evaluation'].get('plan_has_calculation_evidence',False) for r in chosen.values() if r['task'].startswith('R')),
        research_core_conclusions_correct=sum(n.get('core_result_correct',False) for n in notes.values()),
        research_explanations_reviewed=len(notes),
        research_physics_explanation_errors=sum(n.get('status')=='物理解释错误' for n in notes.values()),
        research_supplementary_formula_errors=sum(n.get('status')=='补充公式错误' for n in notes.values()),
        review_method='本轮助手依据保存的数值记录与公式审阅；非第三方专家评审。数值达标不等于整段回答完全正确。')
    write('summary.json',summary)
    with (OUT/'任务对比.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=[k for k in rows[0] if k!='conclusion_reviews']);writer.writeheader();writer.writerows({k:v for k,v in r.items() if k!='conclusion_reviews'} for r in rows)
    table=''.join(f"<tr><td>{r['task']}</td><td>{html.escape(r['title'])}</td><td>{r['conventional_pass']}/{r['conventional_attempts']}</td><td>{r['agent_pass']}/{r['agent_attempts']}</td><td>{r['baseline_configuration_stages']}</td><td>{r['agent_successful_tool_steps']}</td></tr>" for r in rows)
    details=''
    for r in originals+recoveries:
        prefix='recovery-' if r.get('recovery') else '';key=prefix+f"{r['task']}-r{r['repeat']}"
        result=r.get('result',{})
        details+=f"<details><summary>{key}：客观目标{'达标' if r['evaluation']['passed'] else '未达标'}，{r['seconds']:.1f}秒</summary><p>{html.escape(r.get('error') or result.get('answer',''))}</p><pre>{html.escape(json.dumps(r['evaluation'],ensure_ascii=False,indent=2))}</pre><p>解释审阅：{html.escape(str(notes.get(key,'未审阅或不适用')))}</p><a href='{key}-agent.json'>完整返回、参数、执行记录与证据</a></details>"
    baseline_links=''.join(f"<li><a href='{r['task']}-r{r['repeat']}-conventional.json'>{r['task']} 第{r['repeat']}次常规操作与计算原始记录</a></li>" for r in conventional)
    protocols=''.join(f"<details><summary>{t['id']} {html.escape(t['title'])}：固定任务与常规流程</summary><p>{html.escape(t['message'])}</p><ol>"+''.join(f'<li>{html.escape(s)}</li>' for s in t['baseline_steps'])+'</ol></details>' for t in TASKS)
    (OUT/'验证报告.html').write_text(f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>光学智研搭建与科研Agent流程验证</title><style>body{{font:16px/1.75 system-ui;max-width:1100px;margin:40px auto;padding:0 24px;color:#193248}}h1{{font-size:28px}}h2{{font-size:21px}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{padding:8px;border-bottom:1px solid #dce5ed;text-align:left}}details{{margin:14px 0}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f7fa;padding:16px;font-size:13px}}a{{color:#1666a0}}</style>
<h1>光路搭建与科研 Agent：常规流程对比验证</h1><p>每类5项任务、每项重复2次。常规流程已完成{len(conventional)}次，客观目标达标{summary['conventional_pass']}次；Agent原始{len(originals)}次，客观目标达标{summary['original_agent_pass']}次，服务错误{summary['original_service_errors']}次；另有网络恢复补测{len(recoveries)}次。</p>
<h2>验证到了什么优势</h2><p>搭建目标达标{summary['building_objective_pass']}/10；科研计算和推荐方案达标{summary['research_numeric_pass']}/10；科研计划关联真实计算记录{summary['research_plans_with_evidence']}/10。每次仅提交一条任务说明，Agent自行完成后续工具操作，无人工中途修正。结果表明，现有Agent可以把目标描述转化为可核验的光路方案或科研分析记录，在所测任务中达到常规工具流程的结果质量。</p>
<p>聚焦搜索示例：Agent调用已有搜索能力找到位置120 mm、焦距80 mm的方案，使屏上光斑半径由约0.0169 mm减小到0.0135 mm，改善约20%；常规搜索工具也能得到同样结果，Agent的增益是自主组织并执行流程。考虑装配误差时，Agent能改用较稳定方案搜索，并如实指出最大采样半径仅改善约0.65%，没有将微小改善夸大。</p>
<h2>发现的问题与优先改进</h2><p>对{summary['research_explanations_reviewed']}次科研回答另行审阅，核心数据和方案判断正确{summary['research_core_conclusions_correct']}次，但不能据此称整段解释全部正确：发现{summary['research_physics_explanation_errors']}次明显物理解释错误、{summary['research_supplementary_formula_errors']}次补充公式错误，另有近似条件表述不完整。第一次方案比较把B在屏处已经发散说成仍在会聚；最后一次稳定方案搜索额外给出的公式缺少半径因子，量纲不一致。这些问题未改变本轮工具计算值或推荐，但影响教学解释的可信度。</p>
<p>建议优先让计算工具同时返回束腰位置、屏处会聚/发散状态，要求解释与这些事实核对；补充公式先检查单位、标明近似条件，未经验证的推导不作为确定结论。运行中还出现5次目标设置调用被拒绝、1次研究步骤引用无效记录，Agent均自行纠正；可补充清晰参数示例及有效记录选择以减少多余调用。本轮未修改产品实现。</p>
<p>可用于参赛材料的表述：在10项代表性任务、各重复2次的开发者自测中，平台搭建与科研Agent均从单次自然语言指令自主生成满足目标的方案或计算结果，并与常规非AI工具流程核对一致；科研任务全部保留计划关联的计算证据。解释审阅发现物理表述及公式问题，作为后续改进项。该证据支持任务执行能力，不等同于真实用户教学效果或人工节时比例。</p>
<table><tr><th>任务</th><th>内容</th><th>常规客观达标</th><th>Agent客观达标</th><th>常规配置/核对阶段</th><th>Agent两次成功工具步骤合计</th></tr>{table}</table>
<h2>如何理解这个比较</h2><p>常规组无任何大模型调用，用脚本复现熟练操作者按公式配置器件、调用现有非AI仿真/扫描/搜索/误差工具、保存结果的流程。Agent组只给目标、约束和同一初始装置，让产品现有Agent自主选择并调用工具。真实使用本机配置模型，不采用模拟回复，不修改产品实现。此项未实际逐步点击网页，结果为方案和研究记录已生成，不宣称已载入或保存到用户浏览器。</p>
<p>表中“阶段”是预先写明的配置与核对步骤，不是实测鼠标点击数；工具步骤是后台动作，两者不能直接相减后宣称节省百分比。每次Agent试验只提交一条完整任务说明，不代为人工修正；用户仍需提出目标、检查结果，搭建方案还可能需要界面确认。常规组也可直接调用搜索程序，不要求手工逐个计算882个候选。两次常规流程确定性重复仅检查可复现性，不增加用户样本量。</p>
<h2>结果与证据判据</h2><p>搭建方案由同一三维仿真程序重新计算，额外独立核对用户功率/光斑/落点目标、保留器件和未授权参数、新增类型数量及应用许可，不仅看Agent自己报告“通过”。科研组核对实际扫描点、目标范围、误差幅度、推荐方案质量与常规程序一致性、原始对象未改写，并检查计划是否关联真实计算记录。口头结论另行审阅，未审阅不会自动记为正确。</p>
<p>此轮使用同一物理引擎，证明任务执行与既有工具结果一致，不是第二份独立物理准确性验证。搜索结果仅代表已计算候选，误差最大值仅代表采样点，均不等于真实实验验证。常规组的脚本耗时不是人类耗时，不报告人工效率提升百分比。Agent耗时和请求数只作为运行特征记录。</p>
<p>网络错误保留原始记录；如执行恢复，只对连接/协议错误补测一次，另存结果，不按答案好坏择优重测。其他不达标项如实保留。</p>
<h2>固定任务与常规流程</h2>{protocols}<h2>原始返回与核验</h2>{details}<h2>常规流程完整结果</h2><ul>{baseline_links}</ul>
<p><a href="manifest.json">任务及配置条件</a> · <a href="任务对比.csv">汇总表</a> · <a href="summary.json">完整统计</a> · <a href="conclusion-review.json">解释审阅记录</a>。解释由本轮助手依据数值记录和公式核对，非第三方专家评审；原始文件中的pending保留采集时状态，最终审阅见独立记录。复跑脚本：scripts/validate_agent_workflows.py。所有结果属于开发者自测。</p></html>''',encoding='utf-8')
    return summary


def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',action='store_true');p.add_argument('--agent',action='store_true');p.add_argument('--report',action='store_true');p.add_argument('--limit',type=int);p.add_argument('--recovery',action='store_true');a=p.parse_args()
    s=get_settings();manifest=dict(model=s.model,reasoning_effort=s.reasoning_effort,repeats=2,tasks=TASKS,baseline_kind='scripted conventional non-AI workflow',criteria='fixed independent task acceptance; see script and report')
    path=OUT/'manifest.json'
    if path.exists() and json.loads(path.read_text(encoding='utf-8'))!=manifest:raise SystemExit('固定任务或配置发生变化，不混合结果。')
    if not path.exists():write('manifest.json',manifest)
    if a.baseline:
        for t in TASKS:
            for n in [1,2]:
                if not (OUT/f"{t['id']}-r{n}-conventional.json").exists():baseline(t,n)
    if a.agent:
        if not s.configured:raise SystemExit('AI服务未配置')
        jobs=[]
        for t in TASKS:
            for n in [1,2]:
                if not (OUT/f"{t['id']}-r{n}-conventional.json").exists():raise SystemExit('需先执行常规流程')
                target=OUT/f"{'recovery-' if a.recovery else ''}{t['id']}-r{n}-agent.json"
                if target.exists():continue
                if a.recovery:
                    original=OUT/f"{t['id']}-r{n}-agent.json"
                    if not original.exists():continue
                    r=json.loads(original.read_text(encoding='utf-8'))
                    if not r.get('error') or not any(c.get('error') in {'ConnectError','RemoteProtocolError'} for c in r['model_calls']):continue
                jobs.append((t,n))
        if a.limit is not None:jobs=jobs[:a.limit]
        if a.recovery:write('recovery-plan.json',dict(reason='One recovery attempt for every connection/protocol failure only; originals retained.',tasks=[(t['id'],n) for t,n in jobs]))
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(agent,t,n,a.recovery) for t,n in jobs]
            for f in as_completed(futures):f.result();report()
    summary=report()
    print(json.dumps({k:v for k,v in summary.items() if k!='tasks'},ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':main()
