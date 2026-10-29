// Small talk is excluded from automatic titles; research topics are named by the agent.
const smallTalk = /^(?:(?:你好呀?|您好|哈[喽啰]|嗨|hi|hello|hey|早上好|下午好|晚上好|在吗|谢谢(?:你)?|感谢|好的?|嗯|ok|收到|你是谁|你能做什么|你能干什么|测试)[\s，。！？!?.,、~～…]*)+$/iu;
export const isResearchSmallTalk = (value: string) => smallTalk.test(value.trim());
export type ResearchTitleMode = 'pending' | 'auto' | 'manual';

export function restoreResearchTitle(title: string, mode: unknown, turns: { prompt: string; reply: { researchTitle?: string | null } | null }[]): { title: string; titleMode: ResearchTitleMode } {
  if (mode !== undefined && (typeof mode !== 'string' || !['pending', 'auto', 'manual'].includes(mode))) throw new Error('探究标题状态无效。');
  // Rename only the old untouched placeholder, never a title chosen by the user.
  if (title === '未命名研究' && (mode === undefined || mode === 'pending')) return { title: '未命名探究', titleMode: 'pending' };
  if (mode !== undefined) return { title, titleMode: mode as ResearchTitleMode };
  if (title === '未命名探究') return { title, titleMode: 'pending' };
  const first = turns[0]?.prompt.replace(/\s+/g, ' ').slice(0, 24);
  if (title !== first) return { title, titleMode: 'manual' };
  if (!isResearchSmallTalk(title)) return { title, titleMode: 'auto' };
  const topic = turns.find(t => t.reply && !isResearchSmallTalk(t.prompt) && t.prompt.trim().length >= 6);
  if (!topic) return { title: '未命名探究', titleMode: 'pending' };
  const fallback = topic.prompt.replace(/\s+/g, ' ').replace(/^(?:你好|您好)[，,！!。\s]*/, '').replace(/^(?:我想|我希望|请帮我|帮我|请)/, '').split(/[。！？!?\n]/)[0].trim().slice(0, 30);
  return { title: topic.reply?.researchTitle || fallback || '未命名探究', titleMode: topic.reply?.researchTitle ? 'auto' : 'pending' };
}

export function applyResearchTitle<T extends { title: string; titleMode: ResearchTitleMode }>(project: T, title: string | null | undefined): T {
  if (project.titleMode !== 'pending' || !title || isResearchSmallTalk(title)) return project;
  return { ...project, title, titleMode: 'auto' };
}
