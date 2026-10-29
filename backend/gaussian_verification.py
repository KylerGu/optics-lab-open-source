"""Conservative checks of explicit claims against existing Gaussian evidence.

No model call or new simulation is needed. This is deliberately not a general
natural-language proof checker: quoted, conditional and ambiguous claims are
left alone rather than treating a teaching explanation as a measured fact.
"""
import math
import re


REGIONS = {'near': '近场', 'transition': '过渡区', 'far': '远场'}
NUMBER = r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?'
UNITS = {'mm': 1, '毫米': 1, 'cm': 10, '厘米': 10, 'm': 1000, '米': 1000,
         'um': 1e-3, 'μm': 1e-3, 'µm': 1e-3, '微米': 1e-3, 'nm': 1e-6, '纳米': 1e-6,
         'mrad': 1, 'rad': 1000}
UNIT = r'(?:mrad|rad|mm|cm|nm|[uμµ]m|毫米|厘米|微米|纳米|米|m)'
REGION = r'近场(?:束腰)?(?:区)?|过渡区|远场(?:近似)?(?:区)?'


def _beam(result):
    return result.get('gaussian') if result else None


def _rows(scan):
    return [row for row in scan['rows'] if _beam(row.get('result'))]


def _trend(rows):
    values = [row['result']['gaussian']['radiusMm'] for row in rows]
    signs = []
    for left, right in zip(values, values[1:]):
        if not math.isclose(left, right, rel_tol=1e-8, abs_tol=1e-12):
            signs.append(1 if right > left else -1)
    if not signs:
        return '基本不变'
    if all(sign > 0 for sign in signs):
        return '随比较参数增大而增大'
    if all(sign < 0 for sign in signs):
        return '随比较参数增大而减小'
    return '非单调'


def gaussian_facts(evidence, scans):
    """Small, explicit factual digest, using only this turn's tool results."""
    def point(beam):
        return {'束腰半径mm': beam['waistMm'], '波长nm': beam['wavelengthNm'],
                '观察距离mm': beam['distanceMm'], '光斑半径mm': beam['radiusMm'],
                '瑞利长度mm': beam['rayleighMm'], '发散半角mrad': beam['divergenceMrad'],
                '传播区域': REGIONS[beam['region']], '本场景观察距离上限mm': beam['maxDistanceMm'],
                '本场景能否到达远场': beam['farRegionReachable']}
    facts = {}
    if _beam(evidence):
        facts['当前已计算光束'] = point(evidence['gaussian'])
    comparisons = []
    for scan in scans:
        rows = _rows(scan)
        if not rows:
            continue
        minimum = min(rows, key=lambda row: row['result']['gaussian']['radiusMm'])
        comparisons.append({'比较参数': scan['fieldLabel'], '范围单位': scan['unit'],
                            '范围': [rows[0]['value'], rows[-1]['value']],
                            '有效组数': len(rows), '无效组数': len(scan['rows']) - len(rows),
                            '起点': point(rows[0]['result']['gaussian']),
                            '终点': point(rows[-1]['result']['gaussian']),
                            '实际涉及区域': sorted({REGIONS[row['result']['gaussian']['region']] for row in rows}),
                            '光斑趋势': _trend(rows),
                            '已比较点中最小光斑': point(minimum['result']['gaussian'])})
    if comparisons:
        facts['本轮比较'] = comparisons
    return facts


def _plain(answer):
    # Retain numbers in typeset units while removing formatting, not their values.
    text = re.sub(r'\\(?:mathrm|text|operatorname)\{([^{}]*)\}', r'\1', answer)
    text = re.sub(r'\\(?:[,;!]|quad|qquad|left|right)', '', text)
    text = text.replace('\\mu', 'μ').replace('\\theta', 'θ')
    text = text.replace('\\approx', '约').replace('\\simeq', '约').replace('≈', '约')
    text = re.sub(r'[\s${}*]', '', text)
    # Do not mistake a quoted misconception or a question for the answer's claim.
    return re.sub(r'“[^”]*”|「[^」]*」|"[^"\n]*"|`[^`]*`', '', text)


def _conditional(text):
    return bool(re.search(r'如果|假如|假设|若|只在|只有|条件下|不成立|不正确|并非|不是|不能|不应|不一定|并不|未必|说反|错误|[?？]', text))


def _matching_waist(text, beams):
    matches = list(re.finditer(r'束腰(?:半径)?(?:w_?0|w₀)?(?:为|是|=)?(' + NUMBER + ')(' + UNIT + ')', text, re.I))
    if len(matches) != 1 or matches[0][2].lower() in {'rad', 'mrad'}:
        return []
    value = float(matches[0][1]) * UNITS[matches[0][2].lower()]
    return [beam for beam in beams if math.isclose(beam['waistMm'], value, rel_tol=1e-5, abs_tol=1e-9)]


def _region_claim(text):
    # Only an explicit assertion, not a sentence merely discussing far-field laws.
    match = re.search(r'(?:处于|处在|属于|位于|落在|进入|都在|均在|全在|是)(?:了|在)?(' + REGION + r')(?:(?:或|和|与|及|、)(' + REGION + r'))?', text)
    if not match:
        return None
    return {key for group in match.groups() if group for key, label in REGIONS.items() if group.startswith(label)}


def _waist_direction(text):
    return re.search(r'束腰(?:半径)?越(?P<waist>小|大).{0,18}?光斑(?:半径)?(?:就)?越(?P<spot>小|大)', text)


def _condition_conflicts(text, request_message, scans):
    """Check explicit applicability assertions, not general free-form reasoning."""
    issues = []
    hypothesis = _waist_direction(_plain(request_message))
    for sentence in re.split(r'[。！!；;\n]', text):
        for clause in re.split(r'[，,]', sentence):
            if re.search(r'如果|假设|假如|不成立|不是|并非|并不|不一定|未必|错误|不能|不应|[?？]', clause):
                continue
            reference = re.search(r'(?:你的|这个)(?:直观|原来|原先)?(?:直觉|判断|说法|结论|观点).{0,8}?(?:只在|仅在|在|适用于)(近场|远场)', clause)
            if reference and hypothesis:
                positive = hypothesis['waist'] == hypothesis['spot']
                if positive != (reference[1] == '近场'):
                    issues.append('用户原判断的适用区域说反了：固定波长与观察距离时，近场束腰项主导，两种半径同向变化；远场发散项主导，两种半径反向变化。')
        direction = _waist_direction(sentence)
        regions = {name for name in ['近场', '远场'] if name in sentence}
        if direction and len(regions) == 1 and not re.search(r'如果|假设|假如|不成立|不是|错误|不能|不应|[?？]', sentence):
            positive = direction['waist'] == direction['spot']
            if positive != ('近场' in regions):
                issues.append('明确的近远场趋势解释说反了：固定波长和观察距离时，近场束腰项主导、半径同向变化，远场发散项主导、半径反向变化。')
        if len(scans) == 1 and scans[0]['field'] == 'waistMm' and re.search(r'右移|移远|移到更远|移至更远', sentence) and not _conditional(sentence):
            rows = _rows(scans[0])
            cannot = [row['result']['gaussian'] for row in rows if row['result']['gaussian']['maxDistanceMm'] < row['result']['gaussian']['rayleighMm']]
            promise = re.search(r'单调.{0,8}(?:出现|看到|得到|成立)|(?:全部|所有|各组|都).{0,8}(?:进入|到达|处于)远场', sentence)
            if cannot and promise:
                beam = max(cannot, key=lambda item: item['rayleighMm'])
                issues.append(f'不能承诺在现有轨道内右移观察屏就让整组进入远场或出现整段远场单调关系：束腰{beam["waistMm"]:.6g} mm的瑞利长度为{beam["rayleighMm"]:.6g} mm，而最大观察距离仅{beam["maxDistanceMm"]:.6g} mm。')
    return issues


def check_gaussian_answer(answer, evidence, scans, request_message=''):
    """Return concrete conflicts; absence of conflicts is not a full physics proof."""
    if not _beam(evidence) and not any(_rows(scan) for scan in scans):
        return []
    comparisons = [_rows(scan) for scan in scans if _rows(scan)]
    beams = [row['result']['gaussian'] for rows in comparisons for row in rows]
    if _beam(evidence):
        beams.append(evidence['gaussian'])
    text = _plain(answer)
    issues = _condition_conflicts(text, request_message, scans)
    for sentence in re.split(r'[。！!；;\n]', text):
        if not sentence or _conditional(sentence):
            continue
        claimed = _region_claim(sentence)
        selected = _matching_waist(sentence, beams)
        if claimed:
            ordered = re.search(r'(?:两端|两个端点|起点和终点|起点与终点).*?分别(?:处于|属于|是|为)?(' + REGION + r')(?:和|与|及|、)(' + REGION + ')', sentence)
            if ordered and len(comparisons) == 1:
                endpoints = [comparisons[0][0]['result']['gaussian'], comparisons[0][-1]['result']['gaussian']]
                if any(not label.startswith(REGIONS[beam['region']]) for label, beam in zip(ordered.groups(), endpoints)):
                    issues.append('起点与终点的传播区域对应错误：起点为' + REGIONS[endpoints[0]['region']] + '，终点为' + REGIONS[endpoints[1]['region']] + '。')
            if not selected and len(comparisons) == 1:
                rows = comparisons[0]
                if re.search(r'两(?:种极限|端|个端点)|起点.*终点|较小.*较大', sentence):
                    selected = [rows[0]['result']['gaussian'], rows[-1]['result']['gaussian']]
                elif re.search(r'全部|全都|均|都|始终|全程', sentence):
                    selected = [row['result']['gaussian'] for row in rows]
                elif re.search(r'较大束腰|最大束腰', sentence) and scans[0]['field'] == 'waistMm':
                    selected = [rows[-1]['result']['gaussian']]
                elif re.search(r'较小束腰|最小束腰', sentence) and scans[0]['field'] == 'waistMm':
                    selected = [rows[0]['result']['gaussian']]
            if not selected and _beam(evidence) and re.search(r'当前|此时|现在|调参后|调整后', sentence):
                selected = [evidence['gaussian']]
            if selected and any(beam['region'] not in claimed for beam in selected):
                endpoints = [selected[0]] if len(selected) == 1 else [selected[0], selected[-1]]
                facts = '；'.join(f'束腰{beam["waistMm"]:.6g} mm，距离{beam["distanceMm"]:.6g} mm，瑞利长度{beam["rayleighMm"]:.6g} mm，属于{REGIONS[beam["region"]]}' for beam in endpoints)
                issues.append('传播区域判断与计算矛盾：' + facts)

        # Check explicit measured numbers, including rounding and unit conversion.
        fields = [(r'瑞利长度', 'rayleighMm'), (r'发散半角', 'divergenceMrad'),
                  (r'(?:观察|传播)距离|距束腰距离', 'distanceMm'),
                  (r'(?:屏上|观察处)?(?:光斑|光束)半径', 'radiusMm')]
        for label, field in fields:
            pattern = '(?:' + label + r')(?:[a-zA-Z_0-9^\\θπ()]*)(?:约为|约|为|是|等于|=)(' + NUMBER + ')(' + UNIT + ')'
            for match in re.finditer(pattern, sentence, re.I):
                # Targets and suggestions are not measured results.
                if re.search(r'目标|希望|想要|建议|设为|调到', sentence[:match.start()]):
                    continue
                if len(match[1]) > 64:
                    issues.append('回答中的数值格式与本轮计算不符。')
                    continue
                unit = match[2].lower()
                if (field == 'divergenceMrad') != (unit in {'rad', 'mrad'}):
                    issues.append('发散角与长度单位混用。')
                    continue
                value = float(match[1]) * UNITS[unit]
                if not math.isfinite(value):
                    issues.append('回答中的数值不是本轮计算得到的有限数值。')
                    continue
                mantissa, _, exponent = match[1].lower().partition('e')
                decimals = len(mantissa.partition('.')[2])
                tolerance = max(abs(value) * 0.01, 0.5 * 10 ** (int(exponent or '0') - decimals) * UNITS[unit], 1e-10)
                references = selected or beams
                if not selected and _beam(evidence) and re.search(r'当前(?:光束|光斑|观察屏)|此时|调参后|调整后', sentence):
                    references = [evidence['gaussian']]
                if field == 'radiusMm' and re.search(r'最小|最大', sentence[max(0, match.start()-4):match.start()]):
                    pick = min if '最小' in sentence[max(0, match.start()-4):match.start()] else max
                    references = [pick(beams, key=lambda beam: beam[field])]
                if not any(abs(beam[field] - value) <= tolerance for beam in references):
                    actual = sorted({round(beam[field], 8) for beam in references})
                    issues.append(f'{match[0]}与本轮计算不符；该量的已计算范围为{actual[0]:.6g}至{actual[-1]:.6g}，单位为' + ('mrad' if field == 'divergenceMrad' else 'mm') + '。')

        # A sampled U-shaped curve must not be described as monotonic over that range.
        if len(scans) == 1 and scans[0]['field'] == 'waistMm' and comparisons:
            if re.search(r'近场|远场|条件|局部|一段|部分', sentence):
                continue
            trend = _trend(comparisons[0])
            monotonic = re.search(r'光斑(?:半径)?(?:随束腰(?:半径)?(?:增大|减小))?(?:始终|一直|单调|只会)(?:增大|减小|增加|减少|变大|变小)', sentence)
            proportional = _waist_direction(sentence)
            expected = None
            if monotonic:
                expected = '随比较参数增大而减小' if re.search(r'减小|减少|变小', monotonic[0]) else '随比较参数增大而增大'
                if '随束腰减小' in monotonic[0] or '随束腰半径减小' in monotonic[0]:
                    expected = '随比较参数增大而增大' if expected.endswith('减小') else '随比较参数增大而减小'
            if proportional:
                expected = '随比较参数增大而增大' if proportional['waist'] == proportional['spot'] else '随比较参数增大而减小'
            if expected and trend != expected:
                issues.append(f'对整个比较范围的单调趋势判断不符合计算，已比较点的趋势为：{trend}。')
    return list(dict.fromkeys(issues))[:6]


def gaussian_evidence_answer(evidence, scans):
    """Use concise facts if the one permitted rewrite still conflicts or fails."""
    facts = gaussian_facts(evidence, scans)
    paragraphs = []
    for comparison in facts.get('本轮比较', []):
        start, end = comparison['起点'], comparison['终点']
        minimum = comparison['已比较点中最小光斑']
        paragraphs.append(f'本轮比较中，起点束腰为 ${start["束腰半径mm"]:.6g}\\,\\mathrm{{mm}}$，观察处光斑半径约 ${start["光斑半径mm"]:.6g}\\,\\mathrm{{mm}}$，属于{start["传播区域"]}；'
                          f'终点束腰为 ${end["束腰半径mm"]:.6g}\\,\\mathrm{{mm}}$，光斑半径约 ${end["光斑半径mm"]:.6g}\\,\\mathrm{{mm}}$，属于{end["传播区域"]}。'
                          f'随着{comparison["比较参数"]}增大，已比较光斑半径的变化为{comparison["光斑趋势"].removeprefix("随比较参数增大而")}。'
                          f'已比较点中的最小光斑半径约为 ${minimum["光斑半径mm"]:.6g}\\,\\mathrm{{mm}}$。这是所选范围内的有限点比较。')
    if '当前已计算光束' in facts:
        beam = facts['当前已计算光束']
        paragraphs.append(f'当前束腰半径为 ${beam["束腰半径mm"]:.6g}\\,\\mathrm{{mm}}$，观察距离为 ${beam["观察距离mm"]:.6g}\\,\\mathrm{{mm}}$。'
                          f'计算得到光斑半径约 ${beam["光斑半径mm"]:.6g}\\,\\mathrm{{mm}}$、瑞利长度约 ${beam["瑞利长度mm"]:.6g}\\,\\mathrm{{mm}}$，属于{beam["传播区域"]}。')
    return '\n\n'.join(paragraphs)
