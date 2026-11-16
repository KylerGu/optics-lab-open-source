export default function ResearchModelNotes({ notes, warnings, fullNotes = [], title = '物理假设' }: {
  notes: string[]; warnings: string[]; fullNotes?: string[]; title?: string; 'data-detail': 'explanation';
}) {
  const concise = [...new Set([...notes, ...fullNotes].filter(text => text.trim().length > 0))];
  const alerts = [...new Set(warnings.filter(text => text.trim().length > 0))];
  if (!concise.length && !alerts.length) return null;
  return (
    <section className="rw-detail-section rw-model-notes" data-detail="explanation">
      <h3>{title}</h3>
      {concise.map(text => <p className="rw-assumption-line" key={text}>{text}</p>)}
      {alerts.map(text => <p className="rw-result-alert" key={text}>{text}</p>)}
    </section>
  );
}
