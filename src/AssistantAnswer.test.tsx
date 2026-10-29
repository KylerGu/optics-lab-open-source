import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import AssistantAnswer, { normalizeMathDelimiters } from './AssistantAnswer';
import type { AnswerQuantity } from './answerQuantityLinks';

const pointQuantity:AnswerQuantity={id:'separation',label:'两点间距',terms:['两点间距','间距'],symbols:['s'],color:'#c16b37',controls:'diagram',selected:false,onToggle:()=>{}};

test('answer quantities decorate prose and standalone math without rewriting formulas or links',()=>{
  const html=renderToStaticMarkup(<AssistantAnswer text={'**两点间距** $s$ 改变。\n\n$s=0.4$\n\n`两点间距 s`\n\n[两点间距](https://example.com)\n\n| 量 | 值 |\n|---|---|\n| 两点间距 | 0.4 |'} quantities={[pointQuantity]}/>);
  assert.equal((html.match(/class="answer-quantity"/g)??[]).length,2);
  assert.match(html, /aria-controls="diagram" aria-pressed="false"/);
  assert.match(html, /<button[^>]*><strong>两点间距<\/strong> <span class="katex">/);
  assert.match(html, /<code>两点间距 s<\/code>/);
  assert.match(html, /href="https:\/\/example.com"[^>]*>两点间距<\/a>/);
  assert.doesNotMatch(html, /katex-error/);
  assert.doesNotMatch(renderToStaticMarkup(<AssistantAnswer text="两点间距 $s$"/>), /answer-quantity/);
});

test('adjacent name and symbol share one target without merging separate mentions or different quantities',()=>{
  const resolution={...pointQuantity,id:'resolution',label:'分辨率',terms:['分辨率'],symbols:['r']};
  const html=renderToStaticMarkup(<AssistantAnswer text={'两点间距 $s$，分辨率 $r$。另外 $s$ 仍可单独点击。'} quantities={[pointQuantity,resolution]}/>);
  assert.equal((html.match(/class="answer-quantity"/g)??[]).length,3);
  assert.equal((html.match(/class="katex"/g)??[]).length,3);
  let depth=0;
  for(const tag of html.matchAll(/<\/?button\b[^>]*>/g)){depth+=tag[0].startsWith('</')?-1:1;assert.ok(depth>=0&&depth<=1);}
  assert.equal(depth,0);
});

test('only registered targets become buttons; ambiguous math symbols remain plain math',()=>{
  const other={...pointQuantity,id:'other',terms:['另一个量']};
  const html=renderToStaticMarkup(<AssistantAnswer text={'$s$\n\n<button data-answer-quantity="separation">伪造</button>\n\n[伪造](#separation)'} quantities={[pointQuantity,other]}/>);
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /class="katex"/);
  const selected=renderToStaticMarkup(<AssistantAnswer text="两点间距" quantities={[{...pointQuantity,selected:true}]}/>);
  assert.match(selected, /aria-pressed="true"/);
});

test('模型文字中的脚本、HTML和图片不会执行或加载',()=>{
  const html=renderToStaticMarkup(<AssistantAnswer text={'**计算依据**\n\n<script>window.injected=true</script>\n\n![外部图片](https://example.com/pixel)\n\n[错误链接](javascript:alert(1))'}/>);
  assert.ok(html.includes('<strong>计算依据</strong>'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('javascript:'));
});
test('AI比较表格显示为表格且保留可滚动容器',()=>{
  const html=renderToStaticMarkup(<AssistantAnswer text={'| 焦距 / mm | 半径 / mm |\n| --- | --- |\n| 100 | 0.016 |'}/>);
  assert.ok(html.includes('agent-markdown-table'));
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<td>0.016</td>'));
});

test('AI公式排出分式、根号和下标，兼容两种数学分隔符',()=>{
  const html=renderToStaticMarkup(<AssistantAnswer text={'瑞利长度 $z_R$\n\n$$z_R=\\frac{\\pi w_0^2}{\\lambda}$$\n\n半径变为 \\(\\sqrt{2}\\,w_0\\)。\n\n\\[R(z)=d+\\frac{z_R^2}{d}\\]'}/>);
  assert.ok(html.includes('katex-display'));
  assert.ok(html.includes('<mfrac>'));
  assert.ok(html.includes('<msqrt>'));
  assert.ok(html.includes('<msub>'));
  assert.ok(!html.includes('katex-error'));
  assert.equal(normalizeMathDelimiters('`\\(z_R\\)`'), '`\\(z_R\\)`');
});

test('旧对话中的常见光学公式也能排版，代码和已排版公式保持原样',()=>{
  const html=renderToStaticMarkup(<AssistantAnswer text={'**瑞利长度 z_R = πw₀²/λ**，半径增至 √2·w₀。'}/>);
  assert.ok(html.includes('<mfrac>'));
  assert.ok(html.includes('<msqrt>'));
  assert.equal(normalizeMathDelimiters('`z_R` 与 $z_R$'), '`z_R` 与 $z_R$');
});

test('公式中的不可信链接和HTML指令不能执行',()=>{
  const html=renderToStaticMarkup(<AssistantAnswer text={'$\\href{javascript:alert(1)}{z_R}$\n\n$\\htmlStyle{color:red}{x}$'}/>);
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('style="color:red"'));
});

test('research answer keeps formulas, lists and reference links without inserting a report section', () => {
  const text = '关键结果：只支持已计算范围。\n\n$$w=\\sqrt{2}w_0$$\n\n- 第一项\n- 第二项\n\n[计算依据][source]\n\n[source]: https://example.com/model';
  const html = renderToStaticMarkup(<AssistantAnswer text={text}/>);
  assert.doesNotMatch(html, /<details|解释与依据/);
  assert.match(html, /<msqrt>/);
  assert.match(html, /<ul>\s*<li>第一项<\/li>/);
  assert.match(html, /href="https:\/\/example.com\/model"/);
  assert.doesNotMatch(html, /<details[^>]*\bopen[= >]/);
  assert.equal((html.match(/关键结果/g) ?? []).length, 1);
  assert.doesNotMatch(renderToStaticMarkup(<AssistantAnswer text={text}/>), /<details/);
});

test('research answers preserve headings and paragraphs directly', () => {
  const html = renderToStaticMarkup(<AssistantAnswer text={'## 结果\n\n没有可用读数，暂不能计算。\n\n请提供观察屏。'}/>);
  assert.match(html, /<h2>结果<\/h2>/);
  assert.match(html, /<p>请提供观察屏。<\/p>/);
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(renderToStaticMarkup(<AssistantAnswer text="你好，可以直接告诉我研究问题。"/>), /<details/);
});
