import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileUp, FolderOpen, Plus, Search, X } from 'lucide-react';
import { MAX_RESEARCH_OBJECTS, importedObjectChoice, readResearchObjectSources, type ObjectChoice, type ResearchObject } from './researchObjects';

const key = (c: Pick<ObjectChoice, 'source' | 'sourceId'>) => c.source + ':' + c.sourceId;
export default function ResearchObjectPicker({ objects, onChoose, onClose }: { objects: ResearchObject[]; onChoose: (choices: ObjectChoice[]) => void; onClose: () => void }) {
  const [sources] = useState(readResearchObjectSources);
  const [tab, setTab] = useState<'mine' | 'scene' | 'file'>('mine'), [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ObjectChoice[]>([]), [files, setFiles] = useState<ObjectChoice[]>([]);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const used = new Set(objects.map(key)), remaining = MAX_RESEARCH_OBJECTS - objects.length;
  const choices = useMemo(() => [...sources.choices, ...files].filter(c => (tab === 'mine' ? c.source === 'saved' || c.source === 'draft' : c.source === tab) && (c.name + c.label).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [sources, files, tab, query]);
  function toggle(choice: ObjectChoice) {
    setError(null);
    if (selected.some(c => key(c) === key(choice))) { setSelected(s => s.filter(c => key(c) !== key(choice))); return; }
    if (selected.length >= remaining) { setError(`每项探究最多 ${MAX_RESEARCH_OBJECTS} 个对象，请先移除不用的对象。`); return; }
    setSelected(s => [...s, choice]);
  }
  async function importFiles(list: FileList | null) {
    if (!list) return;
    setLoading(true); setError(null);
    const imported: ObjectChoice[] = [];
    try {
      if (list.length > remaining - selected.length) throw new Error('所选文件超过剩余对象数量，请减少文件。');
      for (const file of Array.from(list)) {
        if (file.size > 1024 * 1024) throw new Error(file.name + ' 超过 1 MB，请使用导出的装置 JSON 文件。');
        imported.push(importedObjectChoice(JSON.parse(await file.text()), file.name));
      }
      setFiles(f => [...f, ...imported]); setSelected(s => [...s, ...imported]);
    } catch (reason) { setError(reason instanceof SyntaxError ? '文件不是有效的装置 JSON，请重新选择。' : reason instanceof Error ? reason.message : '文件导入失败。'); }
    finally { setLoading(false); }
  }
  return <dialog ref={dialog} className="rw-dialog rw-object-picker" aria-labelledby="research-object-title" onCancel={onClose}>
    <header><div><h2 id="research-object-title">选择装置</h2><p>从不同来源选择装置，一项探究最多保留 {MAX_RESEARCH_OBJECTS} 个对象。</p></div><button className="rw-icon-button" aria-label="关闭探究对象选择" onClick={onClose}><X size={20}/></button></header>
    <div className="rw-object-tabs" role="tablist" aria-label="探究对象来源">{([{ id: 'mine', label: '我的装置' }, { id: 'scene', label: '仿真场景库' }, { id: 'file', label: '导入装置文件' }] as const).map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setQuery(''); }}>{t.label}</button>)}</div>
    {sources.warnings.map(w => <p key={w} className="rw-warning" role="status">{w}</p>)}
    {tab === 'file' ? <div className="rw-import-box"><FileUp size={26}/><p>导入光路搭建导出的装置 JSON 文件。</p><small>支持当前三维装置和早期直线装置格式，每份不超过 1 MB。</small><button className="rw-button" disabled={loading || !remaining} onClick={() => input.current?.click()}>{loading ? '正在读取…' : '选择本地文件'}</button><input ref={input} type="file" accept=".json,application/json" multiple hidden aria-label="导入探究装置文件" onChange={e => { void importFiles(e.target.files); e.target.value = ''; }}/></div> : <label className="rw-object-search"><Search size={16}/><input aria-label="搜索探究对象" placeholder="搜索名称…" value={query} onChange={e => setQuery(e.target.value)}/></label>}
    <div className="rw-object-choices" role="tabpanel" aria-label={tab === 'mine' ? '我的装置列表' : tab === 'scene' ? '仿真场景列表' : '已读取文件列表'}>{choices.map(c => {
      const attached = used.has(key(c)), checked = selected.some(s => key(s) === key(c));
      return <button key={key(c)} className={`rw-object-choice ${checked ? 'is-selected' : ''}`} disabled={!c.experiment || attached || loading} aria-pressed={checked} onClick={() => toggle(c)}><span className="rw-choice-check">{checked || attached ? <Check size={15}/> : <Plus size={15}/>}</span><span><strong>{c.name}</strong><small>{c.source === 'file' ? c.label + ' · ' : c.source === 'draft' ? '当前光路草稿 · ' : ''}{c.description}</small></span><em>{attached ? '已选入' : !c.experiment ? '暂不可用' : c.source === 'draft' ? '草稿' : c.source === 'saved' ? '已保存' : '可选择'}</em></button>;
    })}{!choices.length && <div className="rw-dialog-empty"><FolderOpen size={24}/><p>{query ? '没有找到相符的对象。' : tab === 'mine' ? '还没有装置。可以从场景库选入，或导入已有文件。' : '尚未读取文件。'}</p></div>}</div>
    {selected.length > 0 && <div className="rw-selected-objects" aria-label="待加入对象">{selected.map(c => <button key={key(c)} onClick={() => toggle(c)}>{c.name}<X size={13}/></button>)}</div>}
    {error && <p className="rw-input-error" role="alert">{error}</p>}
    <p className="rw-small-note">选择后保留此刻的参数；来源中的后续修改不会自动改写探究结果。</p>
    <div className="rw-dialog-actions"><span className="rw-small-note">已保留 {objects.length} 个 · 待加入 {selected.length} 个</span><button className="rw-button" onClick={onClose}>取消</button><button className="rw-button rw-primary" disabled={!selected.length || loading} onClick={() => onChoose(selected)}>加入探究</button></div>
  </dialog>;
}

export function ResearchObjectUpdate({ original, next, onUpdate, onClose }: { original: ResearchObject; next: ResearchObject; onUpdate: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const fields: Record<string, string> = { name: '名称', kind: '类型', position: '位置 / mm', yawDeg: '水平角 / °', pitchDeg: '俯仰角 / °', diameterMm: '口径 / mm', focalLengthMm: '焦距 / mm', beamRadiusMm: '输入半径 / mm', wavelengthNm: '波长 / nm', transmission: '透过率', beamModel: '光束类型', powerMw: '功率 / mW', divergenceMrad: '发散角 / mrad', rayCount: '采样光线数' };
  const changes: { label: string; before: string; after: string }[] = [];
  if (original.experiment.name !== next.experiment.name) changes.push({ label: '装置名称', before: original.experiment.name, after: next.experiment.name });
  for (const e of original.experiment.elements) {
    const n = next.experiment.elements.find(v => v.id === e.id);
    if (!n) { changes.push({ label: e.name, before: '存在', after: '已移除' }); continue; }
    for (const k of Object.keys(fields) as (keyof typeof e)[]) if (JSON.stringify(e[k]) !== JSON.stringify(n[k])) changes.push({ label: e.name + ' · ' + fields[k], before: String(e[k]), after: String(n[k]) });
  }
  for (const n of next.experiment.elements) if (!original.experiment.elements.some(e => e.id === n.id)) changes.push({ label: n.name, before: '不存在', after: '新增器件' });
  return <dialog ref={dialog} className="rw-dialog rw-update-dialog" aria-labelledby="research-update-title" onCancel={onClose}><header><div><h2 id="research-update-title">更新探究对象的参数</h2><p>{original.experiment.name} · 来源：{next.label}</p></div><button className="rw-icon-button" aria-label="关闭参数更新" onClick={onClose}><X size={20}/></button></header>{changes.length ? <div className="rw-table-wrap rw-update-table"><table><thead><tr><th>变化项</th><th>探究中保留的值</th><th>来源中的新值</th></tr></thead><tbody>{changes.map((c, i) => <tr key={i}><td>{c.label}</td><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table></div> : <p>参数与探究中保留的内容一致。</p>}<p className="rw-small-note">更新仅用于之后的计算。已有对话和结果仍保留当时的参数。</p><div className="rw-dialog-actions"><button className="rw-button" onClick={onClose}>取消</button><button className="rw-button rw-primary" onClick={onUpdate}>使用新参数</button></div></dialog>;
}
