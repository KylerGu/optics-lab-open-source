import { numberText, type SceneState } from './sceneRuntime';
import { comparisonColumns, comparisonParameter } from './sceneComparisonColumns';
import type { SceneReply } from './sceneAssistantModel';
import type { SceneInteractionControls } from './sceneInteraction';
import './scene-interaction.css';

export default function SceneComparisonTable({scan,id,interaction,disabled}:{scan:SceneReply['scans'][number];id:string;state:SceneState;interaction?:SceneInteractionControls;disabled:boolean}){
  const selected=interaction?.selectedComparisonId;
  const linked=!!interaction;
  const columns=comparisonColumns(scan),parameter=comparisonParameter(scan);
  return <details className="agent-scan"><summary>{parameter.label}比较（{scan.rows.length}组）</summary>
    {!interaction&&<p>保留原参数，各组均由同一计算程序求得。</p>}
    {selected?.startsWith(id+':')&&<button type="button" className="text-button" disabled={disabled} onClick={()=>interaction?.restoreComparison()}>返回原状态</button>}
    <div className="scan-table-scroll"><table><thead><tr>{interaction&&<th aria-label="查看图示"/>}<th>{linked?parameter.label+(parameter.unit?' / '+parameter.unit:''):'取值'}</th>{columns.map(m=><th key={m.key}>{m.label}{m.unit?' / '+m.unit:linked?'':' / 无量纲'}</th>)}</tr></thead>
      <tbody>{scan.rows.map((row,i)=>{const rowId=id+':'+i,active=selected===rowId;return <tr key={i} className={active?'scene-comparison-selected':undefined}>{interaction&&<td><button type="button" className="text-button" aria-label={`查看第${i+1}组图示`} aria-pressed={active} disabled={disabled} onClick={()=>interaction.showComparison(row.result.input,rowId)}>{active?'查看中':'查看'}</button></td>}<td>{numberText(row.value)}</td>{columns.map(column=><td key={column.key}>{column.format?column.format(column.value(row.result),row.result):numberText(column.value(row.result))}</td>)}</tr>;})}</tbody>
    </table></div>
  </details>;
}
