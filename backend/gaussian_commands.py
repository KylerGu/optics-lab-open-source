"""Recognize unambiguous scene commands before asking a model to choose tools.

Only the current user's text is considered. Questions, hypotheticals, missing
units and compound edits stay in the normal assistant flow.
"""
from dataclasses import dataclass
import re
from typing import Literal


_NUMBER = r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?'
_UNIT = r'(?:毫米|微米|纳米|厘米|mm|[uµμ]m|nm|cm|米|m)'
_QUANTITY = re.compile(rf'(?P<value>{_NUMBER})(?P<unit>{_UNIT})(?![a-z])', re.I)
_SCALE = {'mm': 1, '毫米': 1, 'um': 1e-3, 'µm': 1e-3, 'μm': 1e-3, '微米': 1e-3,
          'nm': 1e-6, '纳米': 1e-6, 'cm': 10, '厘米': 10, 'm': 1000, '米': 1000}


def gaussian_action(message: str) -> bool | None:
    text = re.sub(r'\s+', '', message).lower()
    # A conditional, explanation or preview is never an instruction to edit.
    if re.search(r'(不要|别|先不|暂不|不需要|不想)(?:再|直接)?(?:调|改|设置|应用|载入|执行)', text):
        return False
    if re.search(r'(?:只|仅)(?:想|需要)?(?:问|算|求解|计算|看看)|(?:先|暂时)(?:只)?(?:算|计算|求解|看看)', text):
        return False
    if re.search(r'^(?:请)?(?:解释|告诉我|为什么|比较|对比|扫描)|(?:如果|假如|假设)(?:我|你)?(?:把|将|调|改|设置)|(?:怎么|如何|怎样).*?(?:调|改|设置)|(?:调|改).*?(?:会怎样|会怎么样|会不会|有什么影响|有什么变化|会发生什么)', text):
        return False
    if re.search(r'能否|能.*?(?:达到|达成).*?吗|可行|有哪些解|需要.*?束腰', text):
        return False
    if re.search(r'调(?:整)?(?:到|为|成)|(?:调整|调参)|(?:改|设置|设)(?:为|成|到)|(?:应用|载入|执行)', text):
        return True
    return None


@dataclass(frozen=True)
class GaussianCommand:
    kind: Literal['target', 'waist']
    value_mm: float
    choice: str = 'closest'


def gaussian_command(message: str) -> GaussianCommand | None:
    if gaussian_action(message) is not True:
        return None
    text = re.sub(r'\s+', '', message).lower()
    quantities = list(_QUANTITY.finditer(text))
    if len(quantities) != 1 or re.search(r'["“”「」`]|比较|对比|扫描|为什么|解释|束腰处', text):
        return None
    if re.search(r'(?:波长|观察(?:屏|位置)|束腰位置)(?:也|再)?(?:调|改|移|设)|(?:然后|再|并|同时)(?:把|将)?.*?(?:调|改|移|设置)', text):
        return None
    quantity = quantities[0]
    value = float(quantity['value']) * _SCALE[quantity['unit'].lower()]
    prefix = text[:quantity.start()]
    # Reject unknown qualifiers and extra parameters rather than silently dropping them.
    tail = r'(?:为|是|等于|=|调到|调为|调成|调整到|调整为|改为|改成|改到|设为|设置为|设置成|设置到)*$'
    waist = re.search(r'束腰(?:的)?半径' + tail, prefix)
    spot = re.search(r'光斑(?:的)?(?P<definition>半径|直径)' + tail, prefix)
    if waist:
        return GaussianCommand('waist', value)
    if spot:
        if spot['definition'] == '直径':
            value /= 2
        choice = 'closest'
        if re.search(r'(?:较大|更大|大的)束腰|(?:较大|更大)的解|(?:采用|选择|选|用)(?:较大|更大|大)的(?:解)?[，,。.!！]?$', text):
            choice = 'larger-waist'
        elif re.search(r'(?:较小|更小|小的)束腰|(?:较小|更小)的解|(?:采用|选择|选|用)(?:较小|更小|小)的(?:解)?[，,。.!！]?$', text):
            choice = 'smaller-waist'
        return GaussianCommand('target', value, choice)
    return None
