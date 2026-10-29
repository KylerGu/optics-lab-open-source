"""Compare declared research requirements with actual computation capabilities.

The model identifies requirements from the user's question. The program derives
coverage rather than accepting a self-declared 'experiment completed' flag.
No question templates or keyword matching are used.
"""
from pydantic import Field, model_validator
from .models import StrictModel


PHYSICS = {
    'ideal-camera': ('相机场景的理想成像、取景、几何景深、对焦衍射与像素采样估计，不等于三维装置的实际性能', True),
    'ideal-telescope': ('望远镜场景的理想近轴成像、视场、出瞳与物镜瑞利角分辨率，不等于实际入眼分辨能力', True),
    'ideal-microscope': ('显微镜场景的理想成像、视场、瑞利分辨率及所选判据下的物方景深估计，不等于三维装置的实际性能', True),
    'ray-geometry': ('空间光线、折反射、遮挡与有限采样功率', True),
    'gaussian-envelope': ('理想高斯包络传播与支持的透镜变换', True),
    'single-lens-focus': ('兼容单透镜装置的有限聚焦搜索', True),
    'parameter-errors': ('兼容单透镜装置的位置与焦距偏差', True),
    'polarization': ('支持器件的偏振与波片计算', True),
    'slit-diffraction': ('满足条件的单缝或矩形光栅解析衍射', True),
    'fourier-propagation': ('满足条件的傅里叶透镜与4f复振幅变换', True),
    'ideal-coherent-interference': ('已有光波叠加、双缝、迈克耳孙与薄膜模型的理想相干光场或条纹计算；不含完整空间能流和双端口功率', True),
    'coherent-path-interference': ('任意两路空间光束的相位相干叠加', False),
    'general-wave-propagation': ('一般波动传播与任意孔径衍射', False),
    'measured-data-fitting': ('实测数据拟合与参数辨识', False),
    'literature-search': ('外部文献检索', False),
}


def physics_catalog():
    return [{'id': key, 'description': label, 'supported': supported}
            for key, (label, supported) in PHYSICS.items()]


class ResearchMethod(StrictModel):
    question: str = Field(min_length=1, max_length=1000)
    method: str = Field(min_length=1, max_length=500)
    questionRequires: list[str] = Field(min_length=1, max_length=len(PHYSICS))
    calculationUses: list[str] = Field(default_factory=list, max_length=len(PHYSICS))
    calculationQuestion: str = Field(default='', max_length=500)
    remainingQuestion: str = Field(default='', max_length=500)

    @property
    def coverage(self):
        if not self.calculationUses or any(not PHYSICS[key][1] for key in self.calculationUses):
            return 'unsupported'
        if set(self.questionRequires) <= set(self.calculationUses):
            return 'supported'
        return 'partial'

    @model_validator(mode='after')
    def applicable(self):
        if not self.question.strip() or not self.method.strip():
            raise ValueError('请明确原研究问题与验证方法。')
        for keys in [self.questionRequires, self.calculationUses]:
            if len(set(keys)) != len(keys) or any(key not in PHYSICS for key in keys):
                raise ValueError('请使用计算能力清单中的物理能力编号。')
        if self.calculationUses and not self.calculationQuestion.strip():
            raise ValueError('请说明本次计算实际能回答的子问题。')
        if self.coverage != 'supported' and not self.remainingQuestion.strip():
            raise ValueError('请说明原问题中仍无法验证的部分，不能用替代计算冒充原问题。')
        if self.coverage == 'supported' and self.remainingQuestion.strip():
            raise ValueError('仍有未验证部分时，请补充真实的物理需求，不能声明全部覆盖。')
        return self

    def assessment(self):
        return self.model_dump() | {'coverage': self.coverage}

    def conclusion_scope(self):
        return {'coverage': self.coverage, 'calculationQuestion': self.calculationQuestion,
                'unverifiedQuestion': self.remainingQuestion,
                'rule': '工具执行成功只表示本次计算完成，不能把部分验证或不支持的现象说成原研究问题已经验证。'}
