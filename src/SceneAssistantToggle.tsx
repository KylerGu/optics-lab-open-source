import { createContext, useContext } from 'react';
import { Sparkles } from 'lucide-react';

export const SceneAssistantControls = createContext<{open:boolean;toggle:()=>void}|null>(null);

export default function SceneAssistantToggle(){
  const controls=useContext(SceneAssistantControls);
  if(!controls)return null;
  return <button className={`outline-button assistant-toggle ${controls.open?'active':''}`} onClick={controls.toggle} aria-expanded={controls.open}><Sparkles size={15}/>AI助手</button>;
}
