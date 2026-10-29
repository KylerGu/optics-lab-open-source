import { useEffect, useState } from 'react';
import { FORMULA_TOPICS } from './formulaCatalog';
import { OPTICS_FORMULAS } from './opticsKnowledgeModel';

export const FORMULA_FAVORITES_KEY = 'optics-lab:formula-favorites:v1';
export const FORMULA_FAVORITES_CATEGORY = 'favorites';
const formulaIds = new Set([...FORMULA_TOPICS, ...OPTICS_FORMULAS].map(topic => topic.id));

export function parseFormulaFavorites(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && formulaIds.has(id)))] : [];
  } catch { return []; }
}

function readFavorites(): string[] {
  try { return parseFormulaFavorites(localStorage.getItem(FORMULA_FAVORITES_KEY)); }
  catch { return []; }
}

export function useFormulaFavorites() {
  const [favorites, setFavorites] = useState(readFavorites);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === FORMULA_FAVORITES_KEY || event.key === null) {
        setFavorites(readFavorites());
        setSaveFailed(false);
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const toggleFavorite = (id: string) => {
    if (!formulaIds.has(id)) return;
    const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem(FORMULA_FAVORITES_KEY, JSON.stringify(next));
      setSaveFailed(false);
    } catch { setSaveFailed(true); }
  };
  return { favorites, toggleFavorite, saveFailed };
}
