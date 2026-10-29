export interface ResearchMethodAssessment {
  question: string;
  method: string;
  questionRequires: string[];
  calculationUses: string[];
  calculationQuestion: string;
  remainingQuestion: string;
  coverage: 'supported' | 'partial' | 'unsupported';
}

export function parseResearchMethod(value: unknown): ResearchMethodAssessment | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new Error('实验方法说明无效。');
  const v = value as Record<string, unknown>;
  const text = (name: string, max: number, empty = false): string => {
    const value = v[name];
    if (typeof value !== 'string' || value.length > max || !empty && !value.trim()) throw new Error('实验方法说明无效。');
    return value;
  };
  const keys = (name: string, nonempty: boolean): string[] => {
    const value = v[name];
    if (!Array.isArray(value) || value.length > 32 || nonempty && !value.length || new Set(value).size !== value.length || value.some(key => typeof key !== 'string' || !key.trim() || key.length > 100)) throw new Error('实验物理能力说明无效。');
    return [...value];
  };
  const coverage = v.coverage;
  if (coverage !== 'supported' && coverage !== 'partial' && coverage !== 'unsupported') throw new Error('实验适用范围无效。');
  const result: ResearchMethodAssessment = { question: text('question', 1000), method: text('method', 500), questionRequires: keys('questionRequires', true), calculationUses: keys('calculationUses', false), calculationQuestion: text('calculationQuestion', 500, true), remainingQuestion: text('remainingQuestion', 500, true), coverage };
  if (result.calculationUses.length && !result.calculationQuestion.trim() || coverage !== 'supported' && !result.remainingQuestion.trim() || coverage === 'supported' && (!result.calculationUses.length || result.remainingQuestion.trim() || !result.questionRequires.every(key => result.calculationUses.includes(key)))) throw new Error('实验说明未保留真实的验证范围。');
  return result;
}
