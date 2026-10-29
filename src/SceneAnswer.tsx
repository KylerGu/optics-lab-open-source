import { createContext, useContext, type ReactNode } from 'react';
import AssistantAnswer from './AssistantAnswer';
import type { AnswerQuantity } from './answerQuantityLinks';
import type { SceneState } from './sceneRuntime';
import './scene-answer.css';

type Resolver = (source: SceneState) => readonly AnswerQuantity[];
const Context = createContext<Resolver>(() => []);

export function SceneAnswerProvider({ resolve, children }: { resolve: Resolver; children: ReactNode }) {
  return <Context.Provider value={resolve}>{children}</Context.Provider>;
}

export default function SceneAnswer({ text, source, disabled = false }: { text: string; source: SceneState; disabled?: boolean }) {
  const resolve = useContext(Context);
  return <AssistantAnswer text={text} quantities={disabled ? [] : resolve(source)} />;
}
