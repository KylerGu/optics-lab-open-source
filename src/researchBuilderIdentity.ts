export interface ResearchBuilderOrigin {
  projectId: string;
  objectId: string;
  savedId: string | null;
}

export function researchBuilderKey(origin: ResearchBuilderOrigin): string {
  return JSON.stringify([origin.projectId, origin.objectId]);
}

export function parseResearchBuilderKeys(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 180) throw new Error('研究装置关联无效。');
  const keys = value.map(key => {
    if (typeof key !== 'string' || key.length > 210) throw new Error('研究装置关联无效。');
    const parts: unknown = JSON.parse(key);
    if (!Array.isArray(parts) || parts.length !== 2 || parts.some(part => typeof part !== 'string' || !part.trim() || part.length > 100)) throw new Error('研究装置关联无效。');
    return key;
  });
  if (new Set(keys).size !== keys.length) throw new Error('研究装置关联重复。');
  return keys;
}
