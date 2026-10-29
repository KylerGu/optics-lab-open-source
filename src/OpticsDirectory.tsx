import { useEffect, useState } from 'react';
import { Bookmark, BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { OPTICS_CATEGORIES, opticsCategoryPath, type OpticsCategory } from './opticsOutline';
import { SCENE_CATEGORIES } from './sceneCatalog';
import './optics-directory.css';
import { FORMULA_FAVORITES_CATEGORY } from './formulaFavorites';

export function OpticsDirectory({ kind, selected, onSelect, count }: { kind: 'scenes' | 'formulas'; selected: string; onSelect: (id: string) => void; count: (id: string) => number }) {
  const [expanded, setExpanded] = useState(() => opticsCategoryPath(selected).slice(0, -1).map(category => category.id));
  useEffect(() => { setExpanded(current => [...new Set([...current, ...opticsCategoryPath(selected).slice(0, -1).map(category => category.id)])]); }, [selected]);
  const heading = kind === 'scenes' ? '场景分类' : '学科分类';
  const branch = (category: OpticsCategory) => {
    if(count(category.id) === 0)return null;
    const children=category.children?.filter(child => count(child.id)>0) ?? [];
    return <div className="od-branch" key={category.id}><div className="od-row"><button className={`od-select ${selected === category.id ? 'active' : ''}`} aria-pressed={selected === category.id} onClick={() => onSelect(category.id)}><span>{category.title}</span>{count(category.id) > 0 && <small>{count(category.id)}</small>}</button>{children.length > 0 && <button className="od-expand" aria-label={`${expanded.includes(category.id) ? '收起' : '展开'}${category.title}分类`} aria-expanded={expanded.includes(category.id)} onClick={() => setExpanded(current => current.includes(category.id) ? current.filter(id => id !== category.id) : [...current, category.id])}>{expanded.includes(category.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}</div>{children.length > 0 && expanded.includes(category.id) && <div className="od-children">{children.map(branch)}</div>}</div>;
  };
  return <aside className="optics-directory" aria-label={heading}><h2><BookOpen size={16} />{heading}</h2><nav aria-label={kind === 'scenes' ? '场景分类筛选' : '公式分类筛选'}><div className="od-row"><button className={`od-select ${selected === 'all' ? 'active' : ''}`} aria-pressed={selected === 'all'} onClick={() => onSelect('all')}><span>{kind === 'scenes' ? '全部场景' : '全部公式'}</span><small>{count('all')}</small></button></div>
    {kind === 'formulas' && <div className="od-row od-favorites"><button className={`od-select ${selected === FORMULA_FAVORITES_CATEGORY ? 'active' : ''}`} aria-pressed={selected === FORMULA_FAVORITES_CATEGORY} onClick={() => onSelect(FORMULA_FAVORITES_CATEGORY)}><span><Bookmark size={15} />我的收藏</span><small>{count(FORMULA_FAVORITES_CATEGORY)}</small></button></div>}
    {kind === 'scenes' ? SCENE_CATEGORIES.filter(category => count(category.id)>0).map(category => <div className="od-row" key={category.id}><button className={`od-select ${selected === category.id ? 'active' : ''}`} aria-pressed={selected === category.id} onClick={() => onSelect(category.id)}><span>{category.title}</span><small>{count(category.id)}</small></button></div>) : OPTICS_CATEGORIES.map(branch)}</nav></aside>;
}
