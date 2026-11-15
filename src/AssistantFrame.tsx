import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUp, LoaderCircle, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import './assistant.css';

export default function AssistantFrame({title,prompt,onPrompt,busy,configured,checking,setupError,onCheck,onConfigure,onSend,onStop,onClear,canClear,editing,starters,children,inputError,conversationRevision}:{title:string;prompt:string;onPrompt:(value:string)=>void;busy:boolean;configured:boolean;checking:boolean;setupError?:string|null;onCheck:()=>void;onConfigure?:()=>void;onSend:()=>void;onStop:()=>void;onClear:()=>void;canClear:boolean;editing:boolean;starters:string[];children:ReactNode;inputError?:string|null;conversationRevision?:unknown}){
  const transcript=useRef<HTMLDivElement>(null);
  const textareaRef=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{void import('./researchReadingFonts');},[]);
  useEffect(()=>{
    const el=textareaRef.current;
    if(!el)return;
    el.style.height='auto';
    el.style.height=Math.min(180,Math.max(72,el.scrollHeight))+'px';
  },[prompt,canClear]);
  // Scenes advance this only when conversation content changes, not when viewing a comparison.
  const scrollRevision=conversationRevision===undefined?children:conversationRevision;
  useEffect(()=>{const el=transcript.current,last=el?.lastElementChild;if(el&&last)el.scrollTop+=last.getBoundingClientRect().top-el.getBoundingClientRect().top;},[scrollRevision,busy]);
  const emptyChat=!canClear;
  return <aside className={emptyChat?'assistant-sidebar agent-sidebar is-empty-chat':'assistant-sidebar agent-sidebar'} aria-label="AI光学助手">
    <div className="assistant-heading">
      <h2>{title}</h2>
    </div>
    <div className="agent-chat-column">
      <div className={emptyChat?'agent-conversation is-empty-chat':'agent-conversation'} ref={transcript} role="log" aria-label="AI对话记录" aria-live="polite">
        {emptyChat&&<div className="agent-empty-head"><Sparkles size={18}/><h1>用实验，看懂光学</h1></div>}
        {children}
      </div>
      <div className="agent-composer-area">
        {!configured&&!checking&&<div className="agent-setup"><p>{setupError??'请先在「模型设置」中填写你的 DeepSeek API Key。'}</p>{onConfigure&&<button type="button" className="text-button" onClick={onConfigure} disabled={busy}>模型设置</button>}<button type="button" className="text-button" onClick={onCheck} disabled={busy}><RefreshCw size={13}/>重新检测</button></div>}
        {inputError&&<p className="agent-error agent-input-error" role="alert">{inputError}</p>}
        <form className="agent-compose" onSubmit={e=>{e.preventDefault();onSend();}}>
          <label className="sr-only" htmlFor="agent-prompt">向AI助手提问</label>
          <textarea
            ref={textareaRef}
            id="agent-prompt"
            aria-label="AI实验指令"
            rows={2}
            placeholder={canClear?'继续提问…':'哪个光学现象让你困惑？直接说说你的问题…'}
            value={prompt}
            onChange={e=>onPrompt(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();onSend();}}}
            maxLength={2000}
            disabled={busy}
          />
          <div className="agent-compose-actions">
            {canClear&&<button type="button" className="text-button agent-clear" disabled={busy} onClick={onClear}><Trash2 size={13}/>清空对话</button>}
            {busy
              ?<button type="button" className="agent-send is-busy" onClick={onStop} aria-label="停止" title="停止"><LoaderCircle size={16}/></button>
              :<button type="submit" className="agent-send" aria-label="发送" title="发送 (Ctrl/Cmd+Enter)" aria-keyshortcuts="Control+Enter" disabled={!configured||!prompt.trim()||editing}><ArrowUp size={16}/></button>}
          </div>
        </form>
      </div>
      <div className="agent-empty-tail">
        {emptyChat&&starters.length>0&&<div className="agent-starters" aria-label="快速提问示例">
          {starters.map(text=><button key={text} type="button" onClick={()=>{onPrompt(text);textareaRef.current?.focus();}} disabled={busy}>{text}</button>)}
        </div>}
      </div>
    </div>
  </aside>;
}
