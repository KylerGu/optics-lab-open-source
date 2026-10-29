import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { FORMULA_CATEGORIES, FORMULA_TOPICS, type FormulaId } from './formulaCatalog';
import { normalizeSceneCategory } from './sceneCatalog';
import { SCENE_DEFINITIONS } from './sceneRuntime';
import { OPTICS_FORMULAS } from './opticsKnowledgeModel';
import { FORMULA_FAVORITES_CATEGORY } from './formulaFavorites';

export interface PageRoute {
  area: 'scenes' | 'gaussian' | 'gaussian-focus' | 'scene' | 'formulas' | 'builder' | 'research';
  formula?: FormulaId;
  knowledge?: string;
  sceneId?: string;
  category?: string;
  query?: string;
  page?: number;
}

const isFormula = (id: string | undefined): id is FormulaId => FORMULA_TOPICS.some(topic => topic.id === id);
const categoryIds = (branches = FORMULA_CATEGORIES): string[] => branches.flatMap(branch => [branch.id, ...categoryIds(branch.children ?? [])]);

export function readRoute(hash = window.location.hash): PageRoute {
  const [path, search] = hash.replace(/^#\/?/, '').split('?');
  const [area, id] = path.split('/');
  const params = new URLSearchParams(search);
  const formula = area === 'formulas' ? id : params.get('formula') ?? undefined;
  if (area === 'scenes') return { area, category: normalizeSceneCategory(params.get('category') ?? 'all'), query: params.get('q') ?? '', page: Math.max(1, Math.min(10000, Math.floor(Number(params.get('page')) || 1))) };
  if (area === 'formulas') return { area, formula: isFormula(formula) ? formula : undefined, knowledge: OPTICS_FORMULAS.some(f=>f.id===id) ? id : undefined, category: [...categoryIds(), FORMULA_FAVORITES_CATEGORY].includes(params.get('category') ?? '') ? params.get('category')! : 'all', query: params.get('q') ?? '' };
  if (area === 'scene' && SCENE_DEFINITIONS[id]) return {area,sceneId:id};
  if (area === 'gaussian') return { area, formula: isFormula(formula) ? formula : undefined };
  if (area === 'gaussian-focus') return { area };
  return { area: area === 'builder' || area === 'research' ? area : 'scenes' };
}

export function routeHash(route: PageRoute): string {
  const params = new URLSearchParams();
  if (route.area === 'formulas' || route.area === 'scenes') {
    if (route.category && route.category !== 'all') params.set('category', route.category);
    if (route.query) params.set('q', route.query);
    if (route.area === 'scenes' && route.page && route.page > 1) params.set('page', String(route.page));
  } else if (route.area === 'gaussian' && route.formula) params.set('formula', route.formula);
  return `#/${route.area}${route.area === 'formulas' && (route.formula || route.knowledge) ? '/' + (route.formula || route.knowledge) : route.area === 'scene' && route.sceneId ? '/' + route.sceneId : ''}${params.size ? '?' + params : ''}`;
}

export type Workspace = 'scenes' | 'formulas' | 'builder' | 'research';
export function routeWorkspace(route: PageRoute): Workspace {
  return route.area === 'formulas' || route.area === 'builder' || route.area === 'research' ? route.area : 'scenes';
}

function scrollElements() {
  return [...document.querySelectorAll<HTMLElement>('[data-navigation-scroll]')].filter(el => el.getClientRects().length > 0);
}
function scrollPositions() {
  return { ...Object.fromEntries(scrollElements().map(el => [el.dataset.navigationScroll!, el.scrollTop])), window: window.scrollY };
}

export function usePageNavigation() {
  const [route, setRoute] = useState(readRoute);
  const workspace = routeWorkspace(route);
  const [workspaceRoutes, setWorkspaceRoutes] = useState<Partial<Record<Workspace, PageRoute>>>(() => ({ [workspace]: route }));
  if (workspaceRoutes[workspace] !== route) setWorkspaceRoutes(previous => ({ ...previous, [workspace]: route }));
  const savedScroll = useRef(new Map<string, Record<string, number>>());
  const restoring = useRef(false);
  const currentHash = useRef(routeHash(route));
  const navigate = useCallback((next: PageRoute, replace = false, resume = false) => {
    const hash = routeHash(next);
    if (hash === window.location.hash) return;
    const scroll = scrollPositions();
    savedScroll.current.set(currentHash.current, scroll);
    window.history.replaceState({ ...window.history.state, opticsScroll: scroll }, '');
    const state = { ...(replace ? window.history.state : { previousHash: window.location.hash }), opticsScroll: resume ? savedScroll.current.get(hash) ?? {} : {} };
    window.history[replace ? 'replaceState' : 'pushState'](state, '', hash);
    restoring.current = true;
    currentHash.current = hash;
    setRoute(readRoute(hash));
  }, []);
  const backTo = useCallback((parent: PageRoute) => {
    const previous = window.history.state?.previousHash;
    if (previous === routeHash(parent) || previous && parent.area === 'scenes' && !parent.category && !parent.query && readRoute(previous).area === 'scenes') window.history.back();
    else navigate(parent, true, true);
  }, [navigate]);

  useLayoutEffect(() => {
    if (window.location.hash !== currentHash.current) window.history.replaceState(window.history.state, '', currentHash.current);
    const onPop = () => { if (!restoring.current) savedScroll.current.set(currentHash.current, scrollPositions()); restoring.current = true; currentHash.current = routeHash(readRoute()); setRoute(readRoute()); };
    const onScroll = () => {
      if (!restoring.current) {
        const scroll = scrollPositions();
        savedScroll.current.set(currentHash.current, scroll);
        window.history.replaceState({ ...window.history.state, opticsScroll: scroll }, '');
      }
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    document.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('hashchange', onPop); document.removeEventListener('scroll', onScroll, true); };
  }, []);
  useLayoutEffect(() => {
    restoring.current = true;
    const positions = window.history.state?.opticsScroll ?? {};
    const frame = requestAnimationFrame(() => {
      scrollElements().forEach(el => { el.scrollTop = positions[el.dataset.navigationScroll!] ?? 0; });
      window.scrollTo({ top: positions.window ?? 0, behavior: 'instant' });
      restoring.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [route]);
  const resumeWorkspace = (target: Workspace) => navigate(workspaceRoutes[target] ?? { area: target }, false, true);
  return { route, workspaceRoutes, resumeWorkspace, navigate, backTo };
}
