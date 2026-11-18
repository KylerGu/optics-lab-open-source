import type { PageRoute } from './navigation';

export type StudioViewMode = 'split' | 'builder' | 'research';

export const STUDIO_VIEW_MODE_KEY = 'optics-studio-view-mode-v1';
export const STUDIO_SPLIT_RATIO_KEY = 'optics-studio-split-ratio-v1';
export const DEFAULT_SPLIT_RATIO = 0.44;
export const MIN_SPLIT_RATIO = 0.28;
export const MAX_SPLIT_RATIO = 0.68;

export interface LabLayout {
  split: boolean;
  showResearch: boolean;
  showBuilder: boolean;
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

function isStudioViewMode(value: string | null): value is StudioViewMode {
  return value === 'split' || value === 'builder' || value === 'research';
}

export function readStudioViewMode(): StudioViewMode {
  try {
    if (typeof localStorage === 'undefined') return 'split';
    const raw = localStorage.getItem(STUDIO_VIEW_MODE_KEY);
    return isStudioViewMode(raw) ? raw : 'split';
  } catch {
    return 'split';
  }
}

export function saveStudioViewMode(mode: StudioViewMode): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STUDIO_VIEW_MODE_KEY, mode);
  } catch {
    /* Optional UI preference. */
  }
}

export function readSplitRatio(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_SPLIT_RATIO;
    const raw = localStorage.getItem(STUDIO_SPLIT_RATIO_KEY);
    if (!raw || !raw.trim()) return DEFAULT_SPLIT_RATIO;
    return clampSplitRatio(Number(raw));
  } catch {
    return DEFAULT_SPLIT_RATIO;
  }
}

export function saveSplitRatio(ratio: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STUDIO_SPLIT_RATIO_KEY, String(clampSplitRatio(ratio)));
  } catch {
    /* Optional UI preference. */
  }
}

export function resolveLabLayout(
  routeArea: PageRoute['area'] | string,
  viewMode: StudioViewMode,
): LabLayout {
  if (routeArea !== 'builder' && routeArea !== 'research') {
    return { split: false, showResearch: false, showBuilder: false };
  }
  if (viewMode === 'builder') {
    return { split: false, showResearch: false, showBuilder: true };
  }
  if (viewMode === 'research') {
    return { split: false, showResearch: true, showBuilder: false };
  }
  return { split: true, showResearch: true, showBuilder: true };
}
