"""Present original and network-recovery results without discarding failures."""
import csv
import html
import json
import statistics
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output'/'validation'/'ai-comparison-2026-10-08'
manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
tasks={t['id']:t for t in manifest['tasks']}
primary=[json.loads(f.read_text(encoding='utf-8')) for f in sorted(OUT.glob('T*-r*-*.json'))]
recovery=[json.loads(f.read_text(encoding='utf-8')) for f in sorted(OUT.glob('recovery-T*-r*-*.json'))]
plan=json.loads((OUT/'recovery-plan.json').read_text(encoding='utf-8')) if (OUT/'recovery-plan.json').exists() else {'pairs':[]}
pairs={tuple(p) for p in plan['pairs']}
# For an affected pair, BOTH original arms are replaced in the supplemental
# comparison, even when one originally succeeded. Originals remain reported.
selected=[r for r in primary if (r['task_id'],r['repeat']) not in pairs]+recovery


def aggregate(records):
    groups={}
    for arm in ['ordinary','platform']:
        rs=[r for r in records if r['arm']==arm]
        replies=[r for r in rs if r.get('answer') and not r.get('error')]
        correct=sum(r['score']['correct'] for r in rs)
        groups[arm]=dict(attempts=len(rs),responses=len(replies),correct=correct,
            complete=sum(r['score']['format_complete'] for r in rs),errors=sum(bool(r.get('error')) for r in rs),
            median_success_seconds=statistics.median(r['seconds'] for r in replies) if replies else None,
            mean_success_seconds=statistics.mean(r['seconds'] for r in replies) if replies else None,
            total_model_calls=sum(len(r['model_calls']) for r in rs),
            replies_with_successful_tools=sum(any(t.get('status')=='ok' for t in r.get('trace',[])) for r in replies),
            returned_usage_total_tokens=sum(c.get('usage',{}).get('total_tokens',0) for r in rs for c in r['model_calls']))
    return groups


stats=dict(model=manifest['model'],primary=aggregate(primary),recovery=aggregate(recovery),
           supplemented=aggregate(selected),recovery_pairs=sorted(pairs))
index={(r['task_id'],r['repeat'],r['arm']):r for r in selected}
paired=[]
for id in tasks:
    for repeat in range(1,manifest['repeats']+1):
        ordinary=index.get((id,repeat,'ordinary'));platform=index.get((id,repeat,'platform'))
        if ordinary and platform and ordinary.get('answer') and platform.get('answer'):
            paired.append(dict(task=id,repeat=repeat,ordinary_seconds=ordinary['seconds'],platform_seconds=platform['seconds'],platform_faster=platform['seconds']<ordinary['seconds']))
stats['paired_latency']=dict(complete_pairs=len(paired),platform_faster_pairs=sum(p['platform_faster'] for p in paired),pairs=paired)
(OUT/'最终汇总.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
all_records=[('原始',r) for r in primary]+[('网络恢复补测',r) for r in recovery]
rows=[]
for stage,r in all_records:
    rows.append(dict(stage=stage,task=r['task_id'],title=tasks[r['task_id']]['title'],repeat=r['repeat'],
        arm='普通AI' if r['arm']=='ordinary' else '光学智研',correct=r['score']['correct'],
        complete=r['score']['format_complete'],seconds=round(r['seconds'],3),
        model_calls=len(r['model_calls']),error=r.get('error') or ''))
with (OUT/'完整对比记录.csv').open('w',encoding='utf-8-sig',newline='') as stream:
    writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)


def table(groups):
    content=''
    for arm,g in groups.items():
        seconds='—' if g['median_success_seconds'] is None else f"{g['median_success_seconds']:.1f}"
        content+=f"<tr><td>{'普通 AI 问答' if arm=='ordinary' else '光学智研'}</td><td>{g['correct']}/{g['attempts']}</td><td>{g['responses']}/{g['attempts']}</td><td>{g['errors']}</td><td>{seconds}</td><td>{g['total_model_calls']}</td></tr>"
    return '<table><tr><th>方式</th><th>正确任务</th><th>成功返回</th><th>服务错误</th><th>成功响应中位数/秒</th><th>模型请求数</th></tr>'+content+'</table>'


sg=stats['supplemented']
complete=len(selected)==40 and all(g['responses']==20 for g in sg.values())
if complete and all(g['correct']==20 for g in sg.values()):
    conclusion='补齐受网络影响的成对测试后，两边在这10道题、各2次运行中均为20/20通过。没有观察到正确率提升。'
else:
    conclusion='当前结果见下表。网络恢复补测与原始尝试分别保留；未完成或未通过的项目不能写成通过。'
speed=''
if complete:
    o,p=sg['ordinary']['median_success_seconds'],sg['platform']['median_success_seconds']
    speed=f'成功响应耗时中位数：普通 AI {o:.1f}秒，光学智研 {p:.1f}秒。这里只测服务响应时间，不能推算学生学习效率；不同网络时段和模型随机性也会影响耗时。'
task_rows=''
for id,t in tasks.items():
    counts=[]
    for arm in ['ordinary','platform']:
        subset=[r for r in selected if r['task_id']==id and r['arm']==arm]
        counts.append(f"{sum(r['score']['correct'] for r in subset)}/{len(subset)}")
    task_rows+=f'<tr><td>{id}</td><td>{html.escape(t["title"])}</td><td>{counts[0]}</td><td>{counts[1]}</td></tr>'
details=''
for stage,r in all_records:
    filename=f"{'recovery-' if stage!='原始' else ''}{r['task_id']}-r{r['repeat']}-{r['arm']}.json"
    details+=f"<details><summary>{stage} · {r['task_id']} {html.escape(tasks[r['task_id']]['title'])} · 第{r['repeat']}次 · {'普通AI' if r['arm']=='ordinary' else '光学智研'} · {'通过' if r['score']['correct'] else '未通过'}</summary><pre>{html.escape(r.get('answer') or r.get('error') or '')}</pre><pre>{html.escape(json.dumps(r['score'],ensure_ascii=False,indent=2))}</pre><a href='{filename}'>完整回答、计算依据及请求用量</a></details>"
report=f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>光学智研第二类验证报告</title>
<style>body{{font:16px/1.75 system-ui;max-width:1050px;margin:40px auto;padding:0 24px;color:#193248}}h1{{font-size:28px}}h2{{font-size:21px;margin-top:32px}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{padding:9px;border-bottom:1px solid #dce5ed;text-align:left}}.result{{background:#edf6f4;padding:18px;border-radius:10px}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f7fa;padding:16px;font-size:13px}}details{{margin:14px 0}}a{{color:#1666a0}}</style>
<h1>光学智研：普通 AI 与光学智研同题对比</h1><p>模型：{html.escape(manifest['model'])}；思考设置：{html.escape(manifest['reasoning_effort'])}。10题，每种方式每题2次，原计划40次。当前原始记录{len(primary)}次，网络恢复补测{len(recovery)}次。开发者自测，非第三方评测。</p>
<div class="result"><strong>{conclusion}</strong><p>{speed}</p></div>
<h2>网络恢复后的成对对比</h2>{table(stats['supplemented'])}
<p>选择规则在补测前固定：原始尝试中一方出现连接或协议故障，就把该题该轮的两种方式都补测一次。此表对受影响的整对使用补测记录，其余使用原始记录；不根据答案是否正确挑选结果。补测选择带来的局限：这是网络恢复后的补充比较，不是完整无中断的一轮试验。</p>
<h2>原始40次尝试（保留失败）</h2>{table(stats['primary'])}<p>原始服务失败不能当作物理答错，也不能从记录中删除。此表反映本次运行环境下的完成情况，不能凭一次集中网络中断判断产品长期可靠性。</p>
<h2>单列补测结果</h2>{table(stats['recovery'])}
<h2>题目覆盖</h2><table><tr><th>题号</th><th>内容</th><th>普通AI正确数</th><th>光学智研正确数</th></tr>{task_rows}</table>
<h2>方法与判据</h2><p>两边使用同一模型与思考设置、相同场景定义、参数、共同公式资料和用户问题。普通问答单次作答且没有工具；光学智研运行现有场景助手与物理计算工具。直接调用产品助手并真实访问模型服务，不操作浏览器、不测试网站HTTP路由；不修改产品代码。</p>
<p>测试脚本用独立公式生成参考值，不把平台输出当参考答案。固定评分阈值为绝对偏差≤10⁻⁶+0.5%×|参考值|；判断题必须完全一致。最终JSON中所有要求字段都正确且没有擅自修改场景才算通过。格式不完整与服务失败单独保留；额外解释文字没有进行全面自动评分。20次重复只来自10道题，不是20名用户或20种独立场景。</p>
<p>两边系统提示和可用工具不同，测的是产品整体流程。平台可进行多轮模型调用，普通问答为一轮，不能声称严格等算力。请求按题目与轮次交替顺序，最多并行2个任务；用量和耗时保存在原始记录中。AI生成、网络等待和计算都计入响应耗时，没有测人工操作时间。</p>
<h2>能够支持的结论</h2><p>本轮可用于说明所测计算和边界判断任务的正确性、回答耗时及计算记录可查性。不能据此宣称全站AI正确率100%、教学成绩提升、复杂科研能力已验证或长期稳定性已证明。本轮若两边均正确，材料必须写“未观察到正确率差异”，不能写“准确率提升”。</p>
<p>正式测试前还有两次受限环境连接失败，未收到服务方HTTP响应，已单列保留为预检记录，不纳入40次。<a href="preflight-notes.json">预检说明</a> · <a href="recovery-plan.json">补测计划</a>。</p>
<h2>可复查文件</h2><p><a href="完整对比记录.csv">全部原始与补测汇总</a> · <a href="最终汇总.json">最终统计</a> · <a href="manifest.json">固定题目与参考答案</a>。运行脚本位于项目scripts目录：validate_ai_effect.py、summarize_ai_comparison.py。原始尝试不会被补测覆盖。</p>
<h2>全部原始回答与评分</h2>{details}</html>'''
(OUT/'验证报告.html').write_text(report,encoding='utf-8')
print(json.dumps(stats,ensure_ascii=False,indent=2))
