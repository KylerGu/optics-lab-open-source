import { ArrowLeft, ArrowRight, Focus, Search } from 'lucide-react';
import { OpticsDirectory } from './OpticsDirectory';
import { CATALOG_SCENES, SCENE_CATEGORIES, normalizeSceneCategory } from './sceneCatalog';
import ScenePreview from './ScenePreview';
import type { PageRoute } from './navigation';
import './scene-catalog.css';

interface Props { onOpenGaussian: () => void; route: PageRoute; onNavigate: (route: PageRoute, replace?: boolean) => void }
const PAGE_SIZE = 12;
const OPEN_SCENES = CATALOG_SCENES.filter(scene => scene.available);

export default function CourseCenter({ onOpenGaussian, route, onNavigate }: Props) {
  const requestedCategory = normalizeSceneCategory(route.category ?? 'all');
  const category = requestedCategory === 'all' || OPEN_SCENES.some(scene => scene.categoryId === requestedCategory) ? requestedCategory : 'all';
  const query = route.query ?? '';
  const categoryTitle = SCENE_CATEGORIES.find(group => group.id === category)?.title ?? '全部场景';
  const count = (id: string) => OPEN_SCENES.filter(scene => id === 'all' || scene.categoryId === id).length;
  const chooseCategory = (category: string) => onNavigate({ area: 'scenes', category, query });
  const shown = OPEN_SCENES.filter(scene => (category === 'all' || scene.categoryId === category) && `${scene.title} ${scene.description} ${SCENE_CATEGORIES.find(group => group.id === scene.categoryId)?.title} ${scene.topic === 'gaussian' ? '高斯光束 光斑 波长 束腰 gaussian' : ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(pageCount, route.page ?? 1);
  const visible = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return <main className="scene-catalog-page scene-library" aria-label="仿真场景库" data-navigation-scroll="scene-library">
    <header className="sc-header"><div><h1>仿真场景库</h1><p className="ui-page-description">选择一个光学现象，调节参数，观察变化。</p></div><label className="sc-search"><Search size={17} /><input aria-label="搜索仿真场景" placeholder="搜索场景或装置" value={query} onChange={event => onNavigate({ ...route, query: event.target.value, page: 1 }, true)} /></label></header>
    <div className="sc-layout">
      <OpticsDirectory kind="scenes" selected={category} onSelect={chooseCategory} count={count} />
      <section className="sc-content" aria-label="场景卡片列表">
        <div className="sc-category"><h2>{categoryTitle}</h2><span>{shown.length} 个场景</span></div>
        <div className="sc-grid">{visible.map(scene => {
          const body = <><div className="sc-preview"><ScenePreview scene={scene} /></div><div className="sc-card-body"><h3>{scene.title}</h3><p>{scene.description}</p><span className="sc-open">进入场景<ArrowRight size={16} /></span></div></>;
          return <button className="sc-card sc-ready" key={scene.id} aria-label={`打开${scene.title}场景`} onClick={()=>scene.topic==='gaussian'?onOpenGaussian():scene.id==='beam-transformation-0'?onNavigate({area:'gaussian-focus'}):onNavigate({area:'scene',sceneId:scene.id})}>{body}</button>;
        })}</div>
        {!shown.length && <div className="sc-empty"><Focus size={28} /><p>没有匹配的场景。</p><button className="text-button" onClick={() => onNavigate({ ...route, query: '', page: 1 }, true)}>清除搜索</button></div>}
        {pageCount > 1 && <nav className="sc-pagination" aria-label="场景分页"><button aria-label="上一页场景" disabled={page === 1} onClick={() => onNavigate({ ...route, page: page - 1 })}><ArrowLeft size={16} />上一页</button><span>{page} / {pageCount}</span><button aria-label="下一页场景" disabled={page === pageCount} onClick={() => onNavigate({ ...route, page: page + 1 })}>下一页<ArrowRight size={16} /></button></nav>}
      </section>
    </div>
  </main>;
}
