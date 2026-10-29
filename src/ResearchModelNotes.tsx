export default function ResearchModelNotes({ notes, warnings, fullNotes, title = '结果说明' }: {
  notes: string[]; warnings: string[]; fullNotes: string[]; title?: string; 'data-detail': 'explanation';
}) {
  const concise = [...new Set(notes)];
  const alerts = [...new Set(warnings)];
  const technical = [...new Set(fullNotes)].filter(text => !concise.includes(text) && !alerts.includes(text));
  return <section className="rw-detail-section" data-detail="explanation"><h3>{title}</h3>
    {concise.map(text => <p key={text}>{text}</p>)}
    {alerts.map(text => <p className="rw-result-alert" key={text}>{text}</p>)}
    {technical.length > 0 && <details className="rw-model-full"><summary>完整计算说明</summary>{technical.map(text => <p key={text}>{text}</p>)}</details>}
  </section>;
}
