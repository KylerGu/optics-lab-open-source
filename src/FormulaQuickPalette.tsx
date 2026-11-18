import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, BookOpen, Calculator, ChevronRight, Search, X } from 'lucide-react';
import {
  DEFAULT_FORMULA_VALUES,
  FORMULA_TOPICS,
  type FormulaId,
} from './formulaCatalog';
import { FORMULA_FAVORITES_CATEGORY, useFormulaFavorites } from './formulaFavorites';
import { FormulaKnowledgeCard, FormulaPreview } from './FormulaKnowledge';
import { OPTICS_FORMULAS, OpticsKnowledgeCard } from './OpticsKnowledge';
import { OPTICS_CATEGORIES, inOpticsCategory, opticsCategoryPath } from './opticsOutline';
import type { FormulaPresetRequest } from './researchFormulaLinks';

export interface FormulaQuickPaletteProps {
  open: boolean;
  preset: FormulaPresetRequest | null;
  onClose: () => void;
  onOpenFullLibrary: (formulaId?: FormulaId, knowledgeId?: string) => void;
}

type QuickTopic =
  | {
      kind: 'gaussian';
      id: FormulaId;
      title: string;
      categoryId: string;
      question: string;
      meaning: string;
      latex: string;
      symbol: string;
    }
  | {
      kind: 'optics';
      id: string;
      title: string;
      categoryId: string;
      question: string;
      meaning: string;
      latex: string;
      symbol: string;
    };

const ALL_TOPICS: QuickTopic[] = [
  ...FORMULA_TOPICS.map(topic => ({
    kind: 'gaussian' as const,
    id: topic.id,
    title: topic.title,
    categoryId: topic.categoryId,
    question: topic.question,
    meaning: topic.meaning,
    latex: topic.latex,
    symbol: topic.symbol,
  })),
  ...OPTICS_FORMULAS.map(formula => ({
    kind: 'optics' as const,
    id: formula.id,
    title: formula.title,
    categoryId: formula.categoryId,
    question: formula.question,
    meaning: formula.meaning,
    latex: formula.latex,
    symbol: formula.fields.map(field => field.key).join(' '),
  })),
];

const TOPIC_CATEGORIES = OPTICS_CATEGORIES.filter(category =>
  ALL_TOPICS.some(topic => inOpticsCategory(topic.categoryId, category.id)),
);

export default function FormulaQuickPalette({
  open,
  preset,
  onClose,
  onOpenFullLibrary,
}: FormulaQuickPaletteProps) {
  const { favorites, toggleFavorite } = useFormulaFavorites();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<FormulaPresetRequest | null>(null);
  const consumedPresetId = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !preset || consumedPresetId.current === preset.id) return;
    consumedPresetId.current = preset.id;
    const targetId = preset.formulaId ?? preset.knowledgeId ?? null;
    if (targetId && ALL_TOPICS.some(topic => topic.id === targetId)) {
      setSelectedId(targetId);
      setActivePreset(preset);
      setCategoryId('all');
      setQuery('');
    }
  }, [open, preset]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    if (!selectedId) {
      queueMicrotask(() => searchInputRef.current?.focus());
    } else {
      bodyRef.current?.scrollTo({ top: 0 });
    }
  }, [open, selectedId]);

  const filteredTopics = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return ALL_TOPICS.filter(topic => {
      const inCategory =
        categoryId === FORMULA_FAVORITES_CATEGORY
          ? favorites.includes(topic.id)
          : inOpticsCategory(topic.categoryId, categoryId);
      if (!inCategory) return false;
      if (!normalized) return true;
      const categoryNames = opticsCategoryPath(topic.categoryId)
        .map(category => category.title)
        .join(' ');
      return `${topic.title} ${topic.symbol} ${topic.question} ${topic.meaning} ${categoryNames}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [query, categoryId, favorites]);

  const selectedTopic = useMemo(
    () => (selectedId ? ALL_TOPICS.find(topic => topic.id === selectedId) ?? null : null),
    [selectedId],
  );

  const matchedPreset = useMemo(() => {
    if (!activePreset || !selectedTopic) return null;
    if (
      (activePreset.formulaId && activePreset.formulaId === selectedTopic.id) ||
      (activePreset.knowledgeId && activePreset.knowledgeId === selectedTopic.id)
    ) {
      return activePreset;
    }
    return null;
  }, [activePreset, selectedTopic]);

  if (!open) return null;

  const openFullPage = () => {
    onClose();
    if (selectedTopic?.kind === 'gaussian') {
      onOpenFullLibrary(selectedTopic.id, undefined);
    } else if (selectedTopic?.kind === 'optics') {
      onOpenFullLibrary(undefined, selectedTopic.id);
    } else {
      onOpenFullLibrary(undefined, undefined);
    }
  };

  return (
    <div
      className="fqp-backdrop"
      role="presentation"
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="fqp-drawer"
        role="dialog"
        aria-modal="false"
        aria-label="公式与物理计算速查"
      >
        <header className="fqp-header">
          <div className="fqp-title">
            <Calculator size={18} aria-hidden="true" />
            <div>
              <h2>公式与物理计算速查</h2>
              <span>支持代入参数与反向求解 · Alt+F</span>
            </div>
          </div>
          <div className="fqp-header-actions">
            <button type="button" className="fqp-full-link" onClick={openFullPage}>
              <span>在公式库完整页打开 ↗</span>
            </button>
            <button
              type="button"
              className="icon-button fqp-close"
              aria-label="关闭公式速查"
              title="关闭 (Esc)"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="fqp-controls">
          <label className="fqp-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              aria-label="搜索速查公式"
              value={query}
              placeholder="搜索公式、物理量或光学现象…"
              onChange={event => {
                setQuery(event.target.value);
                setSelectedId(null);
                setActivePreset(null);
              }}
            />
            {query && (
              <button
                type="button"
                aria-label="清空公式搜索"
                onClick={() => {
                  setQuery('');
                  setSelectedId(null);
                  setActivePreset(null);
                }}
              >
                <X size={13} />
              </button>
            )}
          </label>
          <div className="fqp-categories" role="tablist" aria-label="按主题筛选公式">
            <button
              type="button"
              role="tab"
              aria-selected={categoryId === 'all' && !selectedTopic}
              className={categoryId === 'all' ? 'active' : ''}
              onClick={() => {
                setCategoryId('all');
                setSelectedId(null);
                setActivePreset(null);
              }}
            >
              全部 ({ALL_TOPICS.length})
            </button>
            {favorites.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={categoryId === FORMULA_FAVORITES_CATEGORY && !selectedTopic}
                className={categoryId === FORMULA_FAVORITES_CATEGORY ? 'active' : ''}
                onClick={() => {
                  setCategoryId(FORMULA_FAVORITES_CATEGORY);
                  setSelectedId(null);
                  setActivePreset(null);
                }}
              >
                我的收藏 ({favorites.length})
              </button>
            )}
            {TOPIC_CATEGORIES.map(category => (
              <button
                key={category.id}
                type="button"
                role="tab"
                aria-selected={categoryId === category.id && !selectedTopic}
                className={categoryId === category.id ? 'active' : ''}
                onClick={() => {
                  setCategoryId(category.id);
                  setSelectedId(null);
                  setActivePreset(null);
                }}
              >
                {category.title}
              </button>
            ))}
          </div>
        </div>

        <div className="fqp-body" ref={bodyRef}>
          {selectedTopic ? (
            <div className="fqp-detail">
              <div className="fqp-detail-bar">
                <button
                  type="button"
                  className="fqp-back-btn"
                  onClick={() => {
                    setSelectedId(null);
                    setActivePreset(null);
                  }}
                >
                  <ArrowLeft size={14} />
                  <span>返回公式列表（{filteredTopics.length}）</span>
                </button>
                <span className="fqp-category-path">
                  {opticsCategoryPath(selectedTopic.categoryId)
                    .map(category => category.title)
                    .join(' · ')}
                </span>
                <button
                  type="button"
                  className={`fqp-fav-btn ${favorites.includes(selectedTopic.id) ? 'is-saved' : ''}`}
                  aria-pressed={favorites.includes(selectedTopic.id)}
                  aria-label={`${favorites.includes(selectedTopic.id) ? '取消收藏' : '收藏'}${selectedTopic.title}`}
                  onClick={() => toggleFavorite(selectedTopic.id)}
                >
                  <Bookmark
                    size={15}
                    fill={favorites.includes(selectedTopic.id) ? 'currentColor' : 'none'}
                  />
                </button>
              </div>
              <div className="fqp-card-host">
                {selectedTopic.kind === 'gaussian' ? (
                  <FormulaKnowledgeCard
                    key={selectedTopic.id + (matchedPreset ? ':' + matchedPreset.id : '')}
                    id={selectedTopic.id}
                    values={
                      matchedPreset?.values
                        ? { ...DEFAULT_FORMULA_VALUES, ...matchedPreset.values }
                        : undefined
                    }
                    fromScene={!!matchedPreset?.values}
                  />
                ) : (
                  <OpticsKnowledgeCard
                    key={selectedTopic.id + (matchedPreset ? ':' + matchedPreset.id : '')}
                    id={selectedTopic.id}
                    state={matchedPreset?.state}
                    result={matchedPreset?.result}
                    values={matchedPreset?.opticsValues}
                  />
                )}
              </div>
            </div>
          ) : filteredTopics.length ? (
            <div className="fqp-list">
              {filteredTopics.map(topic => {
                const pathLabel =
                  opticsCategoryPath(topic.categoryId).at(-1)?.title ?? '光学公式';
                const saved = favorites.includes(topic.id);
                return (
                  <div key={topic.id} className="fqp-item">
                    <button
                      type="button"
                      className="fqp-item-btn"
                      onClick={() => {
                        setSelectedId(topic.id);
                        setActivePreset(null);
                      }}
                    >
                      <div className="fqp-item-head">
                        <span className="fqp-item-cat">{pathLabel}</span>
                        <strong>{topic.title}</strong>
                      </div>
                      <p>{topic.question}</p>
                      <FormulaPreview id={topic.id} latex={topic.latex} />
                      <span className="fqp-item-cta">
                        <span>展开计算器</span>
                        <ChevronRight size={14} />
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`fqp-item-fav ${saved ? 'is-saved' : ''}`}
                      aria-label={`${saved ? '取消收藏' : '收藏'}${topic.title}`}
                      aria-pressed={saved}
                      onClick={() => toggleFavorite(topic.id)}
                    >
                      <Bookmark size={14} fill={saved ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="fqp-empty">
              <BookOpen size={26} />
              <p>没有匹配的光学公式。</p>
              {query.trim() && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setQuery('');
                    setCategoryId('all');
                  }}
                >
                  清除筛选条件
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
