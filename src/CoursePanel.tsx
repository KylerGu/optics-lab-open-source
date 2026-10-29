import { ArrowLeft, BookOpen, FlaskConical, RotateCcw, Sparkles } from 'lucide-react';
import { LESSONS, type LearningSession, type LessonId } from './teaching';

interface Props {
  session: LearningSession;
  editing: boolean;
  onOpen: (id: LessonId) => void;
  onAsk: (message: string) => void;
  onResearch: (kind: 'design' | 'stability') => void;
  onDirectory: () => void;
}

export default function CoursePanel(props: Props) {
  const lesson = LESSONS.find(item => item.id === props.session.lessonId)!;
  return <details className="experiment-guide" aria-label="实验示例操作提示">
    <summary><BookOpen size={14}/><span>实验操作提示 · {lesson.title.slice(5)}</span><small>展开</small></summary>
    <div className="guide-heading">
      <button className="text-button" onClick={props.onDirectory}><ArrowLeft size={14} />示例目录</button>
      <label className="guide-select"><span>当前示例</span><select aria-label="选择实验示例" value={lesson.id} disabled={props.editing} onChange={event => props.onOpen(event.target.value as LessonId)}>{LESSONS.map(item => <option key={item.id} value={item.id}>{item.title.slice(5)}</option>)}</select></label>
      <button className="text-button" disabled={props.editing} onClick={() => props.onOpen(lesson.id)}><RotateCcw size={14} />重置示例</button>
    </div>
    <p className="guide-action">{lesson.instructions}</p>
    <div className="guide-actions">
      <button className="outline-button" onClick={() => props.onAsk(lesson.prompt)}><Sparkles size={14} />{lesson.id === 'design' || lesson.id === 'tolerance' ? '让AI分析这个实验' : '让AI解释当前现象'}</button>
      {(lesson.id === 'design' || lesson.id === 'tolerance') && <button className="primary-button" onClick={() => props.onResearch(lesson.id === 'design' ? 'design' : 'stability')}><FlaskConical size={14} />{lesson.id === 'design' ? '打开实验设计' : '打开误差分析'}</button>}
      <small>切换与重置会载入示例装置，可撤销。</small>
    </div>
  </details>;
}
