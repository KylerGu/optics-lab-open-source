import type { Element, Root, RootContent, Text } from 'hast';

export interface AnswerQuantity {
  id: string;
  label: string;
  terms: readonly string[];
  symbols?: readonly string[];
  color: string;
  controls: string;
  selected: boolean;
  onToggle: () => void;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeSymbol = (value: string) => value.trim().replace(/\\(?:mathrm|text|mathit)\{([^{}]+)\}/g, '$1').replace(/[{}\s]/g, '');
const button = (quantity: AnswerQuantity, children: Element['children']): Element => ({
  type: 'element', tagName: 'button', properties: { 'data-answer-quantity': quantity.id }, children,
});

// Keep emphasis when a name and its adjacent symbol become one click target.
function quantityButton(node: RootContent): Element | null {
  if (node.type !== 'element') return null;
  if (node.tagName === 'button' && node.properties['data-answer-quantity']) return node;
  if (['strong', 'em'].includes(node.tagName) && node.children.length === 1) {
    const child = quantityButton(node.children[0]);
    if (child) return { ...child, children: [{ ...node, children: child.children }] };
  }
  return null;
}

// Only decorate prose and standalone inline symbols. Links, code, and compound
// equations keep their original content and behavior; the model need not emit markup.
export function rehypeAnswerQuantities({ quantities }: { quantities: readonly AnswerQuantity[] }) {
  const terms = new Map<string, AnswerQuantity>();
  const symbols = new Map<string, AnswerQuantity | null>();
  for (const quantity of quantities) {
    for (const term of quantity.terms) terms.set(term, quantity);
    for (const symbol of quantity.symbols ?? []) {
      const normalized = normalizeSymbol(symbol);
      symbols.set(normalized, symbols.has(normalized) && symbols.get(normalized)?.id !== quantity.id ? null : quantity);
    }
  }
  const pattern = terms.size ? new RegExp([...terms.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join('|'), 'gu') : null;
  function prose(node: Text): Element['children'] {
    if (!pattern) return [node];
    const children: Element['children'] = [];
    let end = 0;
    for (const match of node.value.matchAll(pattern)) {
      const start = match.index!, term = match[0];
      if (/^[A-Za-z0-9_]/.test(term) && /[A-Za-z0-9_]/.test(node.value[start - 1] ?? '') || /[A-Za-z0-9_]$/.test(term) && /[A-Za-z0-9_]/.test(node.value[start + term.length] ?? '')) continue;
      if (start > end) children.push({ type: 'text', value: node.value.slice(end, start) });
      children.push(button(terms.get(term)!, [{ type: 'text', value: term }]));
      end = start + term.length;
    }
    if (end < node.value.length) children.push({ type: 'text', value: node.value.slice(end) });
    return children;
  }
  function walk(parent: Root | Element) {
    parent.children = parent.children.flatMap((node): RootContent[] => {
      if (node.type === 'text') return prose(node);
      if (node.type !== 'element') return [node];
      if (node.tagName === 'code' && Array.isArray(node.properties.className) && node.properties.className.includes('math-inline')) {
        const source = node.children.map(child => child.type === 'text' ? child.value : '').join('');
        const target = symbols.get(normalizeSymbol(source));
        return target ? [button(target, [node])] : [node];
      }
      if (!['a', 'button', 'code', 'pre', 'math', 'svg', 'script', 'style'].includes(node.tagName)) walk(node);
      return [node];
    }) as typeof parent.children;
    for (let i = 0; i < parent.children.length - 1; i++) {
      const first = quantityButton(parent.children[i]);
      if (!first) continue;
      const gap = parent.children[i + 1];
      const spaced = gap.type === 'text' && /^[ \t]+$/.test(gap.value);
      const nextIndex = i + (spaced ? 2 : 1);
      const next = parent.children[nextIndex];
      const second = next && quantityButton(next);
      if (second && first.properties['data-answer-quantity'] === second.properties['data-answer-quantity']) {
        parent.children.splice(i, nextIndex - i + 1, { ...first, children: [...first.children, ...(spaced ? [gap] : []), ...second.children] });
        i--;
      }
    }
  }
  return (tree: Root) => { if (quantities.length) walk(tree); };
}
