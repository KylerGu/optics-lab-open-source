import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { CSSProperties } from 'react';
import { rehypeAnswerQuantities, type AnswerQuantity } from './answerQuantityLinks';
// Accept the two common formula delimiter styles without changing code samples.
export function normalizeMathDelimiters(text: string): string {
  const normalized = text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g).map((part, index) => index % 2 ? part : part
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => `\n\n$$\n${formula.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, formula: string) => `$${formula.trim()}$`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula: string) => `\n\n$$\n${formula.trim()}\n$$\n\n`)).join('');
  // Old replies used a few plain-text optical symbols; typeset these without altering values.
  return normalized.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g).map((part, index) => index % 2 ? part : part
    .replace(/z_R\s*=\s*π\s*w₀²\s*\/\s*λ|√2(?:\s*[·×]\s*w₀)?|(?<!\w)z_R(?!\w)|w₀(?:²)?/g, symbol => {
      if (symbol.includes('=')) return '$z_R=\\frac{\\pi w_0^2}{\\lambda}$';
      if (symbol.startsWith('√2')) return symbol.includes('w₀') ? '$\\sqrt{2}\\,w_0$' : '$\\sqrt{2}$';
      return symbol === 'z_R' ? '$z_R$' : symbol === 'w₀²' ? '$w_0^2$' : '$w_0$';
    })).join('');
}

export default function AssistantAnswer({text,quantities=[]}: {text: string;quantities?:readonly AnswerQuantity[]}) {
  return <div className="agent-markdown"><Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeAnswerQuantities,{quantities}],[rehypeKatex, { trust: false, strict: 'ignore', throwOnError: false, maxExpand: 1000 }]]} skipHtml disallowedElements={['img', 'input']} components={{
    button: ({node, children}) => {
      const quantity=quantities.find(q=>q.id===node?.properties['data-answer-quantity']);
      return quantity?<button type="button" className="answer-quantity" style={{'--answer-quantity-color':quantity.color} as CSSProperties} aria-label={`查看当前${quantity.label}图示`} title={`查看当前${quantity.label}图示`} aria-controls={quantity.controls} aria-pressed={quantity.selected} onClick={quantity.onToggle}>{children}</button>:<span>{children}</span>;
    },
    a: ({href, children}) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
    table: ({children}) => <div className="agent-markdown-table"><table>{children}</table></div>,
  }}>{normalizeMathDelimiters(text)}</Markdown></div>;
}
